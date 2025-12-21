const stripe = require("stripe");
const DatabaseService = require("./DatabaseService");
const EncryptionHelper = require("../helpers/EncryptionHelper");
const EmailTemplateService = require("./email/EmailTemplateService");
const EmailService = require("./email/EmailService");
const {
  FREE_TRIAL_SUFFIX,
  ENTRY_PLAN,
} = require("../constants/subscriptionPlans");

// Constants
const STRIPE_INVOICES_TABLE = "stripe_invoices";
const STRIPE_CONNECTIONS_TABLE = "stripe_connections";
const REFERRAL_EARNINGS_TABLE = "referral_earnings";

/**
 * StripeService - Comprehensive service for handling Stripe operations
 * Handles invoice creation, management, webhooks, and account connections
 */
class StripeService {
  constructor() {
    // Initialize Stripe with secret key
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY environment variable is required");
    }

    this.stripe = stripe(process.env.STRIPE_SECRET_KEY);
    this.connectedAccountsWebhookSecret =
      process.env.STRIPE_CONNECTED_ACCTS_WEBHOOK_SECRET;
    this.platformWebhookSecret = process.env.STRIPE_PLATFORM_WEBHOOK_SECRET;
  }

  /**
   * Validates environment variables required for Stripe operations
   */
  validateEnvironment() {
    const requiredVars = [
      "STRIPE_SECRET_KEY",
      "STRIPE_PUBLISHABLE_KEY",
      "STRIPE_CONNECTED_ACCTS_WEBHOOK_SECRET",
      "STRIPE_PLATFORM_WEBHOOK_SECRET",
      "STRIPE_CLIENT_ID",
      "STRIPE_CONNECT_REDIRECT_URI",
    ];

    const missing = requiredVars.filter((varName) => !process.env[varName]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required Stripe environment variables: ${missing.join(", ")}`
      );
    }

    // Validate encryption key separately for better error messaging
    try {
      EncryptionHelper.validateEncryptionKey();
    } catch (error) {
      throw new Error(
        `Stripe encryption configuration error: ${error.message}`
      );
    }
  }

  /**
   * Validates that a database record exists
   * @param {string} tableName - Table name (without namespace prefix)
   * @param {any} recordValue - Record value to validate
   * @param {string} namespace - Dynamic namespace
   * @param {string} fieldName - Field name to check (defaults to 'id')
   * @returns {Promise<boolean>} Whether the record exists
   */
  async validateDatabaseRecord(
    tableName,
    recordValue,
    namespace,
    fieldName = "id"
  ) {
    try {
      const query = `SELECT 1 FROM ${DatabaseService._sanitizeTableName(
        tableName
      )} WHERE ${DatabaseService._sanitizeColumnName(fieldName)} = ? LIMIT 1`;
      const results = await DatabaseService.query(query, [recordValue]);
      return results.length > 0;
    } catch (error) {
      console.error(`Error validating ${tableName} record:`, error);
      return false;
    }
  }

  /**
   * Creates an invoice on Stripe with pre-validated data and flexible metadata
   * @param {Object} data - Pre-validated invoice data from API layer
   * @param {string} namespace - Dynamic namespace for multi-tenant support
   * @param {string} stripeAccountId - Connected Stripe account ID
   * @returns {Object} Created invoice object
   */
  async createInvoice(data, namespace, stripeAccountId) {
    try {
      // Basic validation (API layer should handle detailed validation)
      if (
        !data.items ||
        !Array.isArray(data.items) ||
        data.items.length === 0
      ) {
        throw new Error("At least one item is required");
      }

      if (!stripeAccountId) {
        throw new Error("Stripe account ID is required");
      }

      // Customer data should already be validated and prepared by API layer
      if (!data.customer) {
        throw new Error("Customer data is required");
      }

      // Create or get customer on connected account
      const customer = await this.createOrGetCustomer(
        data.customer,
        stripeAccountId,
        data.customerMetadata
      );

      // Calculate totals
      const subtotal = data.items.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0
      );

      // Calculate tax amount - support both multiple taxes and legacy single tax
      let taxAmount = 0;
      if (data.taxes && Array.isArray(data.taxes) && data.taxes.length > 0) {
        // Calculate combined tax amount for multiple taxes
        // Note: This is an approximation since actual tax calculation depends on Stripe's tax logic
        taxAmount = data.taxes.reduce((sum, tax) => {
          if (
            tax.percentage &&
            typeof tax.percentage === "number" &&
            tax.percentage >= 0
          ) {
            return sum + Math.round(subtotal * (tax.percentage / 100));
          }
          return sum;
        }, 0);
      } else if (
        data.taxRate &&
        typeof data.taxRate === "number" &&
        data.taxRate >= 0
      ) {
        // Legacy single tax calculation
        taxAmount = Math.round(subtotal * (data.taxRate / 100));
      }

      const total = subtotal + taxAmount;

      // Prepare invoice metadata - merge system metadata with user metadata
      const systemMetadata = {
        created_by: namespace,
        created_from_platform: "true",
        invoice_type: data.isRecurring ? "recurring" : "one_time",
        namespace: namespace,
      };

      // Merge with user-provided metadata (system metadata takes precedence)
      const invoiceMetadata = {
        ...(data.metadata || {}),
        ...systemMetadata,
      };

      // Prepare invoice data
      const invoiceData = {
        customer: customer.id,
        collection_method: "send_invoice",
        due_date: data.dueDate
          ? Math.floor(new Date(data.dueDate).getTime() / 1000)
          : undefined,
        description:
          data.notes || `Invoice for ${customer.name || customer.email}`,
        metadata: invoiceMetadata,
        auto_advance: !data.isDraft, // If draft, don't auto-finalize
        footer: data.notes || "",
        custom_fields: data.customFields || [],
      };

      // Handle tax rates - support both legacy single tax and new multiple taxes
      let taxRateIds = [];

      // Priority 1: Use new multiple taxes format if provided
      if (data.taxes && Array.isArray(data.taxes) && data.taxes.length > 0) {
        for (const tax of data.taxes) {
          // Validate tax object
          if (
            !tax.percentage ||
            typeof tax.percentage !== "number" ||
            tax.percentage < 0
          ) {
            throw new Error(
              `Invalid tax percentage: ${tax.percentage}. Must be a non-negative number.`
            );
          }

          const taxRate = await this.stripe.taxRates.create(
            {
              display_name:
                tax.displayName ||
                tax.taxMetadata?.tax_name ||
                `Tax ${tax.percentage}%`,
              percentage: tax.percentage,
              inclusive: tax.inclusive || false,
              description: tax.description || `Tax rate ${tax.percentage}%`,
            },
            {
              stripeAccount: stripeAccountId,
            }
          );
          taxRateIds.push(taxRate.id);
        }
      }
      // Priority 2: Fallback to legacy single tax format for backward compatibility
      else if (data.taxRate) {
        // Validate legacy tax rate
        if (typeof data.taxRate !== "number" || data.taxRate < 0) {
          throw new Error(
            `Invalid tax rate: ${data.taxRate}. Must be a non-negative number.`
          );
        }

        const taxRate = await this.stripe.taxRates.create(
          {
            display_name: data.taxName || data.taxMetadata?.tax_name || "Tax",
            percentage: data.taxRate,
            inclusive: data.taxInclusive || false,
            description: data.taxDescription || `Tax rate ${data.taxRate}%`,
          },
          {
            stripeAccount: stripeAccountId,
          }
        );
        taxRateIds.push(taxRate.id);
      }

      // Legacy variable for backward compatibility in code below
      const taxRateId = taxRateIds.length > 0 ? taxRateIds[0] : null;

      // Create invoice
      const invoice = await this.stripe.invoices.create(invoiceData, {
        stripeAccount: stripeAccountId,
      });

      // Add line items with tax rates
      for (const item of data.items) {
        // Prepare item metadata - merge system metadata with user metadata
        const itemSystemMetadata = {
          namespace: namespace,
        };

        const itemMetadata = {
          ...(item.metadata || {}),
          ...itemSystemMetadata,
        };

        await this.stripe.invoiceItems.create(
          {
            invoice: invoice.id,
            customer: customer.id,
            description: item.description,
            quantity: item.quantity,
            unit_amount: Math.round(item.unitPrice * 100), // Convert to cents
            metadata: itemMetadata,
            tax_rates: taxRateIds.length > 0 ? taxRateIds : undefined, // Apply all tax rates if any exist
          },
          {
            stripeAccount: stripeAccountId,
          }
        );
      }

      // If not a draft, finalize the invoice
      if (!data.isDraft) {
        await this.stripe.invoices.finalizeInvoice(invoice.id, {
          stripeAccount: stripeAccountId,
        });
      }

      let newInvoice;
      // We fetch new invoice because it has the most recent data of amount due etc.
      try {
        // Use stripe to get the invoice
        newInvoice = await this.stripe.invoices.retrieve(invoice.id, {
          stripeAccount: stripeAccountId,
        });

        console.log("newInvoice");
        console.log(newInvoice);
      } catch {
        // Just console error; we don't want to fail as invoice creation was successful
        console.log(
          "Failed to get new invoice data from stripe after creation"
        );
      }

      // Store invoice in local database (DISABLED for connected accounts via OAuth)
      // await this.storeInvoiceLocally(newInvoice || invoice, namespace, data.userId, stripeAccountId);

      return {
        success: true,
        invoice: newInvoice || invoice,
        localInvoiceId: invoice.id,
      };
    } catch (error) {
      console.error("Error creating Stripe invoice:", error);
      throw new Error(`Failed to create invoice: ${error.message}`);
    }
  }

  /**
   * Lists invoices for a connected Stripe account with metadata filtering
   * @param {string} stripeAccountId - Connected Stripe account ID
   * @param {string} namespace - Dynamic namespace for filtering
   * @param {Object} options - Pagination and filtering options
   * @returns {Object} Filtered invoices list
   */
  async listInvoices(stripeAccountId, namespace, options = {}) {
    try {
      if (!stripeAccountId) {
        throw new Error("Stripe account ID is required");
      }

      const { limit = 100, startingAfter, endingBefore } = options;

      // Get invoices from Stripe
      const invoicesParams = {
        limit: Math.min(limit, 100), // Stripe max is 100
        expand: ["data.customer", "data.payment_intent"],
      };

      if (startingAfter) invoicesParams.starting_after = startingAfter;
      if (endingBefore) invoicesParams.ending_before = endingBefore;

      const invoices = await this.stripe.invoices.list(invoicesParams, {
        stripeAccount: stripeAccountId,
      });

      // Filter invoices created by our platform (by metadata)
      const filteredInvoices = invoices.data.filter(
        (invoice) =>
          invoice.metadata &&
          invoice.metadata.created_by === namespace &&
          invoice.metadata.created_from_platform === "true"
      );

      return {
        success: true,
        invoices: filteredInvoices,
        hasMore: invoices.has_more,
        total: filteredInvoices.length,
      };
    } catch (error) {
      console.error("Error listing Stripe invoices:", error);
      throw new Error(`Failed to list invoices: ${error.message}`);
    }
  }

  /**
   * Retrieves a single invoice by ID with namespace validation
   * @param {string} stripeAccountId - Connected Stripe account ID
   * @param {string} invoiceId - Stripe invoice ID
   * @param {string} namespace - Dynamic namespace for validation
   * @returns {Object} Invoice data with success status
   */
  async retrieveSingleInvoice(stripeAccountId, invoiceId, namespace) {
    try {
      if (!stripeAccountId) {
        throw new Error("Stripe account ID is required");
      }

      if (!invoiceId) {
        throw new Error("Invoice ID is required");
      }

      if (!namespace) {
        throw new Error("Namespace is required");
      }

      // Retrieve invoice from Stripe
      const invoice = await this.stripe.invoices.retrieve(invoiceId, {
        stripeAccount: stripeAccountId,
        expand: ["customer", "payment_intent"],
      });

      // Validate that invoice belongs to our namespace
      if (!invoice.metadata || invoice.metadata.created_by !== namespace) {
        throw new Error("Invoice does not belong to this account");
      }

      // Validate that invoice was created by our platform
      if (
        !invoice.metadata.created_from_platform ||
        invoice.metadata.created_from_platform !== "true"
      ) {
        throw new Error("Invoice was not created by this platform");
      }

      return {
        success: true,
        invoice: invoice,
      };
    } catch (error) {
      console.error("Error retrieving Stripe invoice:", error);

      // Handle specific Stripe errors
      if (error.type === "StripeInvalidRequestError") {
        if (error.message.includes("No such invoice")) {
          throw new Error("Invoice not found");
        }
        throw new Error(`Invalid invoice request: ${error.message}`);
      }

      if (error.type === "StripePermissionError") {
        throw new Error("Access denied to this invoice");
      }

      // Re-throw our custom errors
      if (
        error.message.includes("Invoice does not belong to this account") ||
        error.message.includes("Invoice was not created by this platform") ||
        error.message.includes("Invoice not found")
      ) {
        throw error;
      }

      throw new Error(`Failed to retrieve invoice: ${error.message}`);
    }
  }

  /**
   * Marks an invoice as paid manually (for payments outside Stripe)
   * @param {string} invoiceId - Stripe invoice ID
   * @param {string} stripeAccountId - Connected Stripe account ID
   * @param {number} [actualAmountPaid] - Optional actual amount paid (in cents) to store in metadata
   * @returns {Object} Updated invoice
   */
  async markInvoiceAsPaid(invoiceId, stripeAccountId, actualAmountPaid = null) {
    try {
      if (!invoiceId || !stripeAccountId) {
        throw new Error("Invoice ID and Stripe account ID are required");
      }

      // Validate actualAmountPaid if provided
      if (actualAmountPaid !== null && actualAmountPaid !== undefined) {
        if (typeof actualAmountPaid !== "number" || actualAmountPaid < 0) {
          throw new Error(
            "actualAmountPaid must be a non-negative number in cents"
          );
        }
      }

      // First check if invoice exists and is in correct state
      const invoice = await this.stripe.invoices.retrieve(invoiceId, {
        stripeAccount: stripeAccountId,
      });

      if (invoice.status === "paid") {
        throw new Error("Invoice is already marked as paid");
      }

      if (invoice.status === "draft") {
        throw new Error(
          "Cannot mark draft invoice as paid. Finalize it first."
        );
      }

      // Mark as paid outside of Stripe first (primary operation)
      const updatedInvoice = await this.stripe.invoices.pay(
        invoiceId,
        {
          paid_out_of_band: true,
        },
        {
          stripeAccount: stripeAccountId,
        }
      );

      // Update invoice metadata if actualAmountPaid is provided (secondary operation)
      // Note: metadata parameter is not supported in the pay invoice endpoint
      if (actualAmountPaid !== null && actualAmountPaid !== undefined) {
        try {
          await this.stripe.invoices.update(
            invoiceId,
            {
              metadata: {
                external_payment_amount: actualAmountPaid.toString(),
              },
            },
            {
              stripeAccount: stripeAccountId,
            }
          );
        } catch (metadataError) {
          console.error(
            "Warning: Failed to update invoice metadata:",
            metadataError
          );
          // Continue regardless - invoice is already marked as paid
          // The metadata update is a nice-to-have, not critical
        }
      }

      // Update local database (DISABLED for connected accounts via OAuth)
      // await this.updateInvoiceInDatabase(invoiceId, { status: "paid" });

      return {
        success: true,
        invoice: updatedInvoice,
      };
    } catch (error) {
      console.error("Error marking invoice as paid:", error);
      throw new Error(`Failed to mark invoice as paid: ${error.message}`);
    }
  }

  /**
   * Sends an invoice to the customer
   * @param {string} invoiceId - Stripe invoice ID
   * @param {string} stripeAccountId - Connected Stripe account ID
   * @returns {Object} Sent invoice
   */
  async sendInvoice(invoiceId, stripeAccountId) {
    try {
      if (!invoiceId || !stripeAccountId) {
        throw new Error("Invoice ID and Stripe account ID are required");
      }

      // Check invoice status
      const invoice = await this.stripe.invoices.retrieve(invoiceId, {
        stripeAccount: stripeAccountId,
      });

      if (invoice.status === "draft") {
        throw new Error("Cannot send draft invoice. Finalize it first.");
      }

      // Send invoice
      // Only sends email if customer has allowed email notifications. And only send emails on live mode
      const sentInvoice = await this.stripe.invoices.sendInvoice(invoiceId, {
        stripeAccount: stripeAccountId,
      });

      return {
        success: true,
        invoice: sentInvoice,
      };
    } catch (error) {
      console.error("Error sending invoice:", error);
      throw new Error(`Failed to send invoice: ${error.message}`);
    }
  }

  /**
   * Finalizes a draft invoice and sends it to the customer
   * @param {string} invoiceId - Stripe invoice ID
   * @param {string} stripeAccountId - Connected Stripe account ID
   * @returns {Object} Finalized and sent invoice
   */
  async finalizeDraftAndSendInvoice(invoiceId, stripeAccountId) {
    try {
      if (!invoiceId || !stripeAccountId) {
        throw new Error("Invoice ID and Stripe account ID are required");
      }

      // Check invoice status
      const invoice = await this.stripe.invoices.retrieve(invoiceId, {
        stripeAccount: stripeAccountId,
      });

      if (invoice.status !== "draft") {
        throw new Error("Invoice is not in draft status");
      }

      // Finalize the draft invoice
      const finalizedInvoice = await this.stripe.invoices.finalizeInvoice(
        invoiceId,
        {
          stripeAccount: stripeAccountId,
        }
      );

      // Send the finalized invoice
      const sentInvoice = await this.stripe.invoices.sendInvoice(invoiceId, {
        stripeAccount: stripeAccountId,
      });

      return {
        success: true,
        invoice: sentInvoice,
      };
    } catch (error) {
      console.error("Error finalizing and sending invoice:", error);
      throw new Error(`Failed to finalize and send invoice: ${error.message}`);
    }
  }

  /**
   * Deletes an invoice (only allowed for drafts)
   * @param {string} invoiceId - Stripe invoice ID
   * @param {string} stripeAccountId - Connected Stripe account ID
   * @param {string} namespace - Dynamic namespace
   * @returns {Object} Deletion result
   */
  async deleteInvoice(invoiceId, stripeAccountId, namespace) {
    try {
      if (!invoiceId || !stripeAccountId) {
        throw new Error("Invoice ID and Stripe account ID are required");
      }

      // Check if invoice is in draft status
      const invoice = await this.stripe.invoices.retrieve(invoiceId, {
        stripeAccount: stripeAccountId,
      });

      if (invoice.status !== "draft") {
        throw new Error("Only draft invoices can be deleted");
      }

      // Verify invoice belongs to our namespace
      if (!invoice.metadata || invoice.metadata.created_by !== namespace) {
        throw new Error("Invoice does not belong to this account");
      }

      // Delete from Stripe
      await this.stripe.invoices.del(invoiceId, {
        stripeAccount: stripeAccountId,
      });

      // Remove from local database (DISABLED for connected accounts via OAuth)
      // await this.deleteInvoiceFromDatabase(invoiceId, namespace);

      return {
        success: true,
        message: "Invoice deleted successfully",
      };
    } catch (error) {
      console.error("Error deleting invoice:", error);
      throw new Error(`Failed to delete invoice: ${error.message}`);
    }
  }

  /**
   * Creates or retrieves existing customer with flexible data
   * @param {Object} customerData - Customer data (from lead or custom)
   * @param {string} stripeAccountId - Connected Stripe account ID
   * @param {Object} userMetadata - User-provided metadata for customer
   * @returns {Object} Stripe customer object
   */
  async createOrGetCustomer(customerData, stripeAccountId, userMetadata = {}) {
    try {
      if (!customerData.email) {
        throw new Error("Customer email is required");
      }

      // First try to find existing customer by email
      const existingCustomers = await this.stripe.customers.list(
        {
          email: customerData.email,
          limit: 1,
        },
        {
          stripeAccount: stripeAccountId,
        }
      );

      if (existingCustomers.data.length > 0) {
        return existingCustomers.data[0];
      }

      // Prepare customer metadata - merge system metadata with user metadata
      const systemMetadata = {
        source: "platform_integration",
        namespace: DatabaseService.getNamespace(),
      };

      const customerMetadata = {
        ...userMetadata,
        ...systemMetadata,
      };

      // Create new customer
      const customer = await this.stripe.customers.create(
        {
          email: customerData.email,
          name: customerData.name || customerData.email,
          description:
            customerData.description ||
            `Customer: ${customerData.name || customerData.email}`,
          phone: customerData.phone || undefined,
          address: customerData.address || undefined,
          metadata: customerMetadata,
        },
        {
          stripeAccount: stripeAccountId,
        }
      );

      return customer;
    } catch (error) {
      console.error("Error creating/getting customer:", error);
      throw new Error(`Failed to create customer: ${error.message}`);
    }
  }

  /**
   * Stores invoice data in local database
   * @param {Object} invoice - Stripe invoice object
   * @param {string} namespace - Dynamic namespace
   * @param {number} userId - User ID
   * @param {string} stripeAccountId - Connected Stripe account ID
   */
  async storeInvoiceLocally(invoice, namespace, userId, stripeAccountId) {
    // DISABLED: Local invoice storage is disabled for connected accounts via OAuth.
    try {
      // Ensure table exists
      await this.ensureStripeInvoicesTable(namespace);

      const invoiceData = {
        stripe_invoice_id: invoice.id,
        user_id: userId,
        stripe_user_id: stripeAccountId,
        namespace: namespace,
        invoice_data: JSON.stringify(invoice),
        status: invoice.status,
        amount_due: invoice.amount_due, // Store in cents as received from Stripe
        amount_paid: this.getActualAmountPaid(invoice),
        currency: invoice.currency,
        customer_email: invoice.customer_email,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const fields = Object.keys(invoiceData).join(", ");
      const placeholders = Object.keys(invoiceData)
        .map(() => "?")
        .join(", ");
      const values = Object.values(invoiceData);

      const query = `
        INSERT INTO ${DatabaseService._sanitizeTableName(
          STRIPE_INVOICES_TABLE
        )} 
        (${fields}) 
        VALUES (${placeholders})
        ON DUPLICATE KEY UPDATE
        invoice_data = VALUES(invoice_data),
        status = VALUES(status),
        amount_due = VALUES(amount_due),
        amount_paid = VALUES(amount_paid),
        updated_at = VALUES(updated_at)
      `;

      await DatabaseService.query(query, values);
    } catch (error) {
      console.error("Error storing invoice locally:", error);
      // Don't throw here as Stripe invoice was created successfully
    }
  }

  /**
   * Updates invoice in local database
   * @param {string} invoiceId - Stripe invoice ID
   * @param {Object} updates - Fields to update
   */
  async updateInvoiceInDatabase(invoiceId, updates) {
    // DISABLED: Local invoice update is disabled for connected accounts via OAuth.
    try {
      const fields = Object.keys(updates)
        .map((key) => `${key} = ?`)
        .join(", ");
      const values = [...Object.values(updates), invoiceId];

      const query = `
        UPDATE ${DatabaseService._sanitizeTableName(STRIPE_INVOICES_TABLE)} 
        SET ${fields}, updated_at = NOW() 
        WHERE stripe_invoice_id = ?
      `;

      await DatabaseService.query(query, values);
    } catch (error) {
      console.error("Error updating invoice in database:", error);
    }
  }

  /**
   * Deletes invoice from local database
   * @param {string} invoiceId - Stripe invoice ID
   * @param {string} namespace - Dynamic namespace
   */
  async deleteInvoiceFromDatabase(invoiceId, namespace) {
    // DISABLED: Local invoice deletion is disabled for connected accounts via OAuth.
    try {
      const query = `DELETE FROM ${DatabaseService._sanitizeTableName(
        STRIPE_INVOICES_TABLE
      )} WHERE stripe_invoice_id = ?`;
      await DatabaseService.query(query, [invoiceId]);
    } catch (error) {
      console.error("Error deleting invoice from database:", error);
    }
  }

  async createBillingPortalSession(customerId) {
    const getNamespaceEnv = require("../helpers/getNamespaceEnv");
    const namespace = DatabaseService.getNamespace();
    const baseUrl =
      getNamespaceEnv(namespace, "BASE_URL") || process.env.BASE_URL;
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: baseUrl,
    });
    // const customerSession = await this.stripe.customerSessions.create({
    //   customer: customerId,
    //   components: {
    //     pricing_table: { enabled: true },
    //   },
    // });

    return {
      success: true,
      url: session.url,
    };
  }

  /**
   * Processes Stripe webhook events for connected accounts
   * @param {string} payload - Raw webhook payload
   * @param {string} signature - Stripe signature header
   * @returns {Object} Processing result
   */
  async processWebhookConnectedAccount(payload, signature) {
    // NOTE: This is deprecated, reason being stripe doesn't send webhooks for connected accounts, connected through stripe connect (oauth).
    // We use stripe api to get the invoice data instead.

    // UPDATE: I'm now learning that this is possible if you set it correctly from workbench - https://dashboard.stripe.com/test/workbench/webhooks/create
    try {
      if (!this.connectedAccountsWebhookSecret) {
        console.log("Connected accounts webhook secret not configured");
        throw new Error("Connected accounts webhook secret not configured");
      }

      // Verify webhook signature
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.connectedAccountsWebhookSecret
      );

      console.log(`Processing stripe webhook event: ${event.type}`);
      console.log("event", event);

      // Handle different event types
      switch (event.type) {
        case "invoice.created":
          await this.handleInvoiceCreated(event.data.object);
          break;

        case "invoice.updated":
          await this.handleInvoiceUpdated(event.data.object);
          break;

        case "invoice.deleted":
          await this.handleInvoiceDeleted(event.data.object);
          break;

        case "invoice.payment_succeeded":
        case "invoice.paid":
        case "invoice_payment.paid":
          await this.handleInvoicePaymentSucceeded(event.data.object);
          break;

        case "invoice.payment_failed":
        case "invoice.finalization_failed":
          await this.handleInvoicePaymentFailed(event.data.object);
          break;

        case "invoice.finalized":
          await this.handleInvoiceFinalized(event.data.object);
          break;

        default:
          console.log(`Unhandled event type: ${event.type}`);
      }

      return {
        success: true,
        eventType: event.type,
        processed: true,
      };
    } catch (error) {
      console.error("Webhook processing error:", error);
      throw new Error(`Webhook processing failed: ${error.message}`);
    }
  }

  /**
   * Processes Stripe webhook events for the current platform
   * @param {string} payload - Raw webhook payload
   * @param {string} signature - Stripe signature header
   * @returns {Object} Processing result
   */
  async processWebhookPlatform(payload, signature) {
    try {
      if (!this.platformWebhookSecret) {
        console.log("Platform webhook secret not configured");
        throw new Error("Platform webhook secret not configured");
      }

      // Verify webhook signature
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.platformWebhookSecret
      );

      console.log(`Processing stripe webhook event: ${event.type}`);
      console.log("event", event);

      // Handle different event types
      switch (event.type) {
        case "invoice.paid":
          await this.handlePaymentPaid(event.data.object);
          break;

        case "invoice.payment_failed":
          await this.handlePaymentFailed(event.data.object);
          break;

        case "customer.subscription.updated":
          await this.handleSubscriptionUpdated(event.data.object);
          break;

        case "customer.subscription.deleted":
          await this.handleSubscriptionDeleted(event.data.object);
          break;

        default:
          console.log(`Unhandled event type: ${event.type}`);
      }

      return {
        success: true,
        eventType: event.type,
        processed: true,
      };
    } catch (error) {
      console.error("Webhook processing error:", error);
      throw new Error(`Webhook processing failed: ${error.message}`);
    }
  }

  /**
   * Applies trial information to the user record.
    
    This function looks for a 'trial_end' in the invoice line item.
    If not found and a subscription_id is provided, it will fetch the
    subscription object from Stripe. If trial details are found, it appends
    FREE_TRIAL_SUFFIX to the price lookup key and sets the trial_end_date.
    
    It also updates the subscription period (start and end dates) on the user.
    
    Returns the plan_id (lookup_key) so that further processing continues.
   */
  async applyTrialInfo(invoiceLineItem, subscriptionId = null) {
    const userMetaUpdates = {};
    try {
      // Extract plan details from the price object
      const planPrice = invoiceLineItem.price || {};
      const subscriptionItems = await this.stripe.subscriptionItems.list({
        subscription: subscriptionId,
        expand: ["data.price"],
      });

      const firstItem = subscriptionItems?.data[0];
      const planId = firstItem?.price?.lookup_key || firstItem?.price?.id;

      userMetaUpdates.stripe_subscription_plan = planId;

      // Start by trying to get trial_end from the invoice line item
      let trialEndTimestamp = invoiceLineItem?.trial_end;

      // Fallback: if trial_end is not directly provided, try retrieving via subscription_id
      if (!trialEndTimestamp && subscriptionId) {
        try {
          console.log("subscription_id", subscriptionId);
          console.log(
            "Could not find trial_end in invoice line item in payload, fetching subscription object from stripe"
          );
          const subscriptionObj = await this.stripe.subscriptions.retrieve(
            subscriptionId
          );
          console.log("subscription object", subscriptionObj);
          trialEndTimestamp = subscriptionObj.trial_end;
        } catch (e) {
          console.log("Error retrieving subscription trial details:", e);
          trialEndTimestamp = null;
        }
      }

      // Set the subscription field with a "FREE_TRIAL_SUFFIX" suffix if a trial exists
      if (trialEndTimestamp) {
        try {
          const trialEndDate = new Date(trialEndTimestamp * 1000);
          userMetaUpdates.stripe_subscription_plan = `${planId}${FREE_TRIAL_SUFFIX}`;
          userMetaUpdates.stripe_trial_end_date = trialEndDate;
        } catch (e) {
          console.log("Error converting trial_end_timestamp:", e);
          userMetaUpdates.stripe_trial_end_date = null;
        }
      } else {
        userMetaUpdates.stripe_subscription_plan = planId;
        userMetaUpdates.stripe_trial_end_date = null;
      }

      // Update subscription period start and end dates from the invoice line item
      const period = invoiceLineItem.period || {};
      const startTimestamp = period.start;
      const endTimestamp = period.end;

      if (startTimestamp) {
        userMetaUpdates.stripe_subscription_start_at = new Date(
          startTimestamp * 1000
        );
      }
      if (endTimestamp) {
        userMetaUpdates.stripe_subscription_end_at = new Date(
          endTimestamp * 1000
        );
      }

      return userMetaUpdates;
    } catch (ex) {
      console.log("Error in applyTrialInfo helper function:", ex);
      throw ex;
    }
  }

  /**
   * Helper method to get user with meta data by stripe customer ID
   * @param {string} customerId - Stripe customer ID
   * @returns {Promise<Object|null>} User with meta data or null
   */
  async getUserByStripeCustomerId(customerId) {
    try {
      if (!customerId) {
        return null;
      }

      // Find user meta with stripe_customer_id
      const userMeta = await DatabaseService.findOne("users_meta", {
        where: { stripe_customer_id: customerId },
      });

      if (!userMeta) {
        return null;
      }

      // Get the user record
      const user = await DatabaseService.findOne("users", {
        where: { id: userMeta.user_id },
      });

      if (!user) {
        return null;
      }

      return { user, userMeta };
    } catch (error) {
      console.error("Error getting user by stripe customer ID:", error);
      return null;
    }
  }

  /**
   * Helper method to get user with meta data by email
   * @param {string} email - User email
   * @returns {Promise<Object|null>} User with meta data or null
   */
  async getUserByEmail(email) {
    try {
      if (!email) {
        return null;
      }

      // Find user by email
      const user = await DatabaseService.findOne("users", {
        where: { email: email },
      });

      if (!user) {
        return null;
      }

      // Get or create user meta
      let userMeta = await DatabaseService.findOne("users_meta", {
        where: { user_id: user.id },
      });

      if (!userMeta) {
        // Create user meta if it doesn't exist
        const defaultName = user.email.split("@")[0]; // Get part before @ as name
        const insertResult = await DatabaseService.insert("users_meta", {
          user_id: user.id,
          name: defaultName,
          role: "user", // Default role
        });
        userMeta = {
          id: insertResult.id,
          user_id: user.id,
          name: defaultName,
          role: "user",
        };
      }

      return { user, userMeta };
    } catch (error) {
      console.error("Error getting user by email:", error);
      return null;
    }
  }

  /**
   * Helper method to get user with meta data by stripe subscription ID
   * @param {string} subscriptionId - Stripe subscription ID
   * @returns {Promise<Object|null>} User with meta data or null
   */
  async getUserByStripeSubscriptionId(subscriptionId) {
    try {
      if (!subscriptionId) {
        return null;
      }

      // Find user meta with stripe_subscription_id
      const userMeta = await DatabaseService.findOne("users_meta", {
        where: { stripe_subscription_id: subscriptionId },
      });

      if (!userMeta) {
        return null;
      }

      // Get the user record
      const user = await DatabaseService.findOne("users", {
        where: { id: userMeta.user_id },
      });

      if (!user) {
        return null;
      }

      return { user, userMeta };
    } catch (error) {
      console.error("Error getting user by stripe subscription ID:", error);
      return null;
    }
  }

  /**
   * Helper method to update user meta fields
   * @param {number} userId - User ID
   * @param {Object} metaData - Meta data to update
   * @returns {Promise<boolean>} Success status
   */
  async updateUserMeta(userId, metaData) {
    try {
      if (!userId || !metaData || Object.keys(metaData).length === 0) {
        return false;
      }

      // Ensure user meta exists
      let userMeta = await DatabaseService.findOne("users_meta", {
        where: { user_id: userId },
      });

      if (!userMeta) {
        // Create user meta if it doesn't exist
        const user = await DatabaseService.findOne("users", {
          where: { id: userId },
        });

        if (!user) {
          console.error(`User with id ${userId} not found`);
          return false;
        }

        const defaultName = user.email.split("@")[0]; // Get part before @ as name
        await DatabaseService.insert("users_meta", {
          user_id: userId,
          name: defaultName,
          role: "user", // Default role
          ...metaData,
          updated_at: new Date(),
        });
      } else {
        // Update existing user meta
        await DatabaseService.update("users_meta", metaData, {
          user_id: userId,
        });
      }

      return true;
    } catch (error) {
      console.error("Error updating user meta:", error);
      return false;
    }
  }

  /**
   * Handle payment paid event
   */
  async handlePaymentPaid(invoice) {
    try {
      console.log("handling payment paid");

      const customerId = invoice.customer;
      const email = invoice.customer_email;
      const subscriptionId =
        invoice.parent?.subscription_details?.subscription ||
        invoice?.subscription;

      if (!customerId || !email || !subscriptionId) {
        console.error("Missing required customer information in invoice");
        return { error: "Missing required customer information in invoice" };
      }

      // Try to fetch user by customerId first
      let userData = await this.getUserByStripeCustomerId(customerId);

      if (!userData) {
        // Fallback: fetch by email
        userData = await this.getUserByEmail(email);
      }

      if (userData) {
        const { user, userMeta } = userData;
        console.log("user who paid", user.id, userMeta.referrer_id);

        // Defensive check: If the user's referrerId equals their own id, clear it
        if (userMeta.referrer_id === user.id) {
          console.log(
            `Detected invalid self-referral for user ${user.id}. Resetting referrerId to null.`
          );
          await this.updateUserMeta(user.id, { referrer_id: null });
        }

        const subscriptionLineItem = invoice.lines.data[0];
        const userMetaUpdates = await this.applyTrialInfo(
          subscriptionLineItem,
          subscriptionId
        );

        // Update user meta with stripe data
        const metaUpdateData = {
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: customerId,
          ...userMetaUpdates, // Include the updated data from applyTrialInfo
        };

        await this.updateUserMeta(user.id, metaUpdateData);

        // Update user status and updated_at
        await DatabaseService.update(
          "users",
          {
            status: "active",
            updated_at: new Date(),
          },
          {
            id: user.id,
          }
        );
        // Process referral earnings only if a valid external referrer exists
        // Note: ReferralEarning related code is kept as requested
        if (userMeta.referrer_id) {
          const referrerData = await DatabaseService.findOne("users", {
            where: { id: userMeta.referrer_id },
          });
          console.log(
            "user who referred new user",
            referrerData?.id,
            referrerData
          );

          // Process referral earnings if referrer exists and is active
          if (referrerData && referrerData.status === "active") {
            try {
              const namespace = DatabaseService.getNamespace();

              // Ensure referral earnings table exists
              await this.ensureReferralEarningsTable(namespace);

              const amtPaid = invoice.amount_paid || 0;
              if (amtPaid > 0) {
                // Calculate 10% of the payment amount (amount is already in cents)
                const referralAmount = Math.floor(amtPaid * 0.1);

                // Get subscription period from invoice line item
                const subscriptionPeriod = invoice.lines?.data?.[0]?.period;
                if (!subscriptionPeriod?.start || !subscriptionPeriod?.end) {
                  console.error(
                    "Missing subscription period in invoice line item"
                  );
                  return;
                }

                // Check if this is first-time earning for this referrer-referee pair
                const existingEarning = await DatabaseService.findOne(
                  REFERRAL_EARNINGS_TABLE,
                  {
                    where: {
                      referrer_id: referrerData.id,
                      referee_id: user.id,
                    },
                  }
                );

                // Determine earning type: 1 = first-time, 2 = recurring
                const billingReason = invoice.billing_reason;
                let earningType = 2; // Default to recurring

                // If no existing earning and billing reason indicates subscription creation
                if (
                  !existingEarning &&
                  (billingReason === "subscription_create" || !billingReason)
                ) {
                  earningType = 1; // First-time
                } else if (billingReason === "subscription_cycle") {
                  earningType = 2; // Recurring
                }

                // Create referral earning record
                await DatabaseService.insert(REFERRAL_EARNINGS_TABLE, {
                  referrer_id: referrerData.id,
                  referee_id: user.id,
                  amount: referralAmount,
                  type: earningType,
                  status: "pending",
                  subscription_id: subscriptionId,
                  subscription_period_start: new Date(
                    subscriptionPeriod.start * 1000
                  ),
                  subscription_period_end: new Date(
                    subscriptionPeriod.end * 1000
                  ),
                });

                console.log(
                  `Created referral earning record for referrer ${
                    referrerData.id
                  }, amount: ${referralAmount} cents, type: ${
                    earningType === 1 ? "first-time" : "recurring"
                  }`
                );
              }
            } catch (error) {
              console.error("Error processing referral earning:", error);
              // Don't throw - continue with other processing
            }
          }
        } else {
          console.log(
            `Referral processing skipped for user ${user.id} (referrerId is not set).`
          );
        }
      } else {
        console.log("User not found for email:", email);
      }
    } catch (e) {
      console.log("An error occurred while handling invoice paid:", e);
    }
  }
  /**
   * Handle payment failed event
   */
  async handlePaymentFailed(invoice) {
    try {
      console.log("Payment failed:", invoice);
      const customerId = invoice.customer;
      const userData = await this.getUserByStripeCustomerId(customerId);

      if (userData) {
        const { user, userMeta } = userData;
        const currentDate = new Date();

        // If the user is on a trial and the trial_end_date is missing or expired,
        // revert them immediately to the free plan "entry"
        if (
          userMeta.stripe_subscription_plan?.endsWith(FREE_TRIAL_SUFFIX) &&
          (!userMeta.stripe_trial_end_date ||
            currentDate > new Date(userMeta.stripe_trial_end_date))
        ) {
          console.log(
            `Trial expired for user ${user.id}; reverting subscription to 'entry'.`
          );
          await this.updateUserMeta(user.id, {
            stripe_subscription_plan: ENTRY_PLAN,
            stripe_trial_end_date: null,
          });
        } else {
          // Otherwise, if the user is not on a trial or still within the trial period,
          // mark the status as UNPAID
          await DatabaseService.update(
            "users",
            {
              status: "unpaid",
              updated_at: new Date(),
            },
            {
              id: user.id,
            }
          );
        }

        // Send payment failed notification email
        try {
          const emailTemplate =
            EmailTemplateService.generateCustomEmailTemplateWithHtml(
              "Payment Failed - Action Required",
              `<p>Hi ${userMeta.name || user.email.split("@")[0]},</p>
              <p>We noticed that your recent payment was unsuccessful. This could be due to:</p>
              <ul>
                <li>Insufficient funds</li>
                <li>Expired card</li>
                <li>Incorrect card details</li>
                <li>Bank decline</li>
              </ul>
              <p>To ensure uninterrupted access to your account, please update your payment information or contact your bank.</p>
              <p>If you need any assistance, please don't hesitate to reach out to our support team at ${
                process.env.BREVO_REPLY_TO
              }.</p>

              <p>Best regards,<br>
              The Support Team</p>
            `,
              {
                footerText: "",
              }
            );

          const emailData = {
            recipient: user.email,
            subject: emailTemplate.subject,
            body: emailTemplate.body,
            replyTo: process.env.BREVO_REPLY_TO,
            metadata: {
              type: "payment_failed_notification",
              userId: String(user.id),
            },
          };
          const namespace = DatabaseService.getNamespace();
          await EmailService.sendEmail(
            user.id,
            emailData,
            {
              provider: "smtp",
              skipFallback: true,
            },
            namespace
          );

          console.log("Payment failed notification email sent successfully");
        } catch (emailError) {
          console.error(
            "Failed to send payment failed notification:",
            emailError
          );
          // Don't throw error since this is a non-critical operation
        }
      } else {
        console.log("User not found with customerId:", customerId);
      }
    } catch (e) {
      console.log("An error occurred while payment failed:", e);
      return { error: "Error", status: 500 };
    }
  }

  /**
   * Handle subscription updated event
   */
  async handleSubscriptionUpdated(subscription) {
    try {
      const customerId = subscription.customer;
      const cancellationDetail = subscription.cancellation_details;
      const canceledAt = subscription.canceled_at;
      const status = subscription.status;
      const userData = await this.getUserByStripeCustomerId(customerId);

      if (userData) {
        const { user, userMeta } = userData;

        if (subscription.cancel_at_period_end) {
          // Update meta with cancel reason and user status
          await this.updateUserMeta(user.id, {
            stripe_cancel_reason: cancellationDetail?.reason || null,
          });

          await DatabaseService.update(
            "users",
            {
              status: "to_be_cancelled",
              updated_at: new Date(),
            },
            {
              id: user.id,
            }
          );
        } else {
          const planId = subscription.items.data[0].price.lookup_key;
          const trialEnd = subscription.trial_end;

          const metaUpdates = {};

          if (trialEnd) {
            const trialEndDate = new Date(trialEnd * 1000);
            metaUpdates.stripe_subscription_plan = `${planId}${FREE_TRIAL_SUFFIX}`;
            metaUpdates.stripe_trial_end_date = trialEndDate;
          } else {
            metaUpdates.stripe_subscription_plan = planId;
            metaUpdates.stripe_trial_end_date = null;
          }

          await this.updateUserMeta(user.id, metaUpdates);

          let newUserStatus = user.status; // Keep current status by default

          if (
            ["past_due", "unpaid", "failed"].includes(status) &&
            userMeta.stripe_subscription_id === subscription.id
          ) {
            newUserStatus = "unpaid";
          }

          if (
            ["active", "paid"].includes(status) &&
            userMeta.stripe_subscription_id === subscription.id
          ) {
            newUserStatus = "active";
          }

          await DatabaseService.update(
            "users",
            {
              status: newUserStatus,
              updated_at: new Date(),
            },
            {
              id: user.id,
            }
          );

          console.log("updated plan");
        }
      } else {
        console.log("User not found with customerId:", customerId);
      }
    } catch (e) {
      console.log("An error occurred while subscription updated:", e);
    }
  }

  /**
   * Handle subscription deleted event
   */
  async handleSubscriptionDeleted(subscription) {
    try {
      console.log("Subscription Deleted:", subscription);
      const subscriptionId = subscription.id;
      const userData = await this.getUserByStripeSubscriptionId(subscriptionId);

      if (userData) {
        const { user, userMeta } = userData;

        // Update user status
        await DatabaseService.update(
          "users",
          {
            status: "canceled",
            updated_at: new Date(),
          },
          {
            id: user.id,
          }
        );

        // Update user meta subscription plan
        await this.updateUserMeta(user.id, {
          stripe_subscription_plan: ENTRY_PLAN,
        });
      } else {
        console.log("User not found with subscriptionID:", subscriptionId);
      }
    } catch (e) {
      console.log("An error occurred while handling subscription deleted:", e);
    }
  }

  /**
   * Handles invoice.created webhook
   */
  async handleInvoiceCreated(invoice) {
    // Only process invoices created by our platform
    if (invoice.metadata && invoice.metadata.created_from_platform === "true") {
      console.log(`Invoice created: ${invoice.id}`);
      // Additional processing can be added here
    }
  }

  /**
   * Handles invoice.updated webhook
   */
  async handleInvoiceUpdated(invoice) {
    if (invoice.metadata && invoice.metadata.created_from_platform === "true") {
      const namespace = invoice.metadata.created_by;
      if (namespace) {
        // DISABLED: Local invoice update for connected accounts via OAuth.
        // await this.updateInvoiceInDatabase(invoice.id, {
        //   status: invoice.status,
        //   amount_due: invoice.amount_due,
        //   amount_paid: invoice.amount_paid,
        //   invoice_data: JSON.stringify(invoice),
        // });
      }
    }
  }

  /**
   * Handles invoice.deleted webhook
   */
  async handleInvoiceDeleted(invoice) {
    if (invoice.metadata && invoice.metadata.created_from_platform === "true") {
      const namespace = invoice.metadata.created_by;
      if (namespace) {
        // DISABLED: Local invoice deletion for connected accounts via OAuth.
        // await this.deleteInvoiceFromDatabase(invoice.id, namespace);
      }
    }
  }

  /**
   * Handles invoice.payment_succeeded webhook
   */
  async handleInvoicePaymentSucceeded(invoice) {
    // Since when we pay out of band this might trigger, confirm it does so it doesn't reset our out of band settings.
    if (invoice.metadata && invoice.metadata.created_from_platform === "true") {
      const namespace = invoice.metadata.created_by;
      if (namespace) {
        // DISABLED: Local invoice update for connected accounts via OAuth.
        // await this.updateInvoiceInDatabase(invoice.id, {
        //   status: "paid",
        //   amount_paid: invoice.amount_paid,
        // });
      }
    }
  }

  /**
   * Handles invoice.payment_failed webhook
   */
  async handleInvoicePaymentFailed(invoice) {
    if (invoice.metadata && invoice.metadata.created_from_platform === "true") {
      const namespace = invoice.metadata.created_by;
      if (namespace) {
        // DISABLED: Local invoice update for connected accounts via OAuth.
        // await this.updateInvoiceInDatabase(invoice.id, {
        //   status: "payment_failed",
        // });
      }
    }
  }

  /**
   * Handles invoice.finalized webhook
   */
  async handleInvoiceFinalized(invoice) {
    if (invoice.metadata && invoice.metadata.created_from_platform === "true") {
      const namespace = invoice.metadata.created_by;
      if (namespace) {
        // DISABLED: Local invoice update for connected accounts via OAuth.
        // await this.updateInvoiceInDatabase(invoice.id, {
        //   status: "open",
        //   invoice_data: JSON.stringify(invoice),
        // });
      }
    }
  }

  /**
   * Ensures the stripe_invoices table exists for the namespace
   * @param {string} namespace - Dynamic namespace
   */
  async ensureStripeInvoicesTable(namespace) {
    // DISABLED: Local invoice table creation is disabled for connected accounts via OAuth.
    try {
      // First, try to query the table to see if it exists
      try {
        await DatabaseService.query(
          `SELECT 1 FROM ${DatabaseService._sanitizeTableName(
            STRIPE_INVOICES_TABLE
          )} LIMIT 1`
        );
        return; // Table exists
      } catch (error) {
        // Table doesn't exist, create it
        if (
          error.message.includes("doesn't exist") ||
          error.message.includes("Table") ||
          error.message.includes("ER_NO_SUCH_TABLE") ||
          error.message.includes("ENOTFOUND") ||
          error.code === "ER_NO_SUCH_TABLE"
        ) {
          const createTableSQL = `
            CREATE TABLE ${DatabaseService._sanitizeTableName(
              STRIPE_INVOICES_TABLE
            )} (
              id INT AUTO_INCREMENT PRIMARY KEY,
              stripe_invoice_id VARCHAR(255) NOT NULL UNIQUE,
              user_id INT NOT NULL,
              stripe_user_id VARCHAR(255) NOT NULL,
              namespace VARCHAR(200) NOT NULL,
              invoice_data JSON NOT NULL,
              status VARCHAR(50) NOT NULL,
              amount_due BIGINT NOT NULL DEFAULT 0,
              amount_paid BIGINT NOT NULL DEFAULT 0,
              currency VARCHAR(3) NOT NULL DEFAULT 'usd',
              customer_email VARCHAR(255),
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              INDEX idx_user_id (user_id),
              INDEX idx_stripe_user_id (stripe_user_id),
              INDEX idx_status (status),
              INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `;

          await DatabaseService.query(createTableSQL);
          console.log(
            `Created stripe_invoices table for namespace: ${namespace}`
          );
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error("Error ensuring stripe_invoices table:", error);
      throw new Error("Failed to create or verify stripe invoices table");
    }
  }

  /**
   * Ensures the stripe_connections table exists for the namespace
   * @param {string} namespace - Dynamic namespace
   */
  /**
   * Ensures the referral_earnings table exists for the namespace with all required columns
   * @param {string} namespace - Dynamic namespace
   */
  async ensureReferralEarningsTable(namespace) {
    try {
      // First, try to query the table to see if it exists
      try {
        await DatabaseService.query(
          `SELECT 1 FROM ${DatabaseService._sanitizeTableName(
            REFERRAL_EARNINGS_TABLE
          )} LIMIT 1`
        );
        return; // Table exists
      } catch (error) {
        // Table doesn't exist, create it
        if (
          error.message.includes("doesn't exist") ||
          error.message.includes("Table") ||
          error.message.includes("ER_NO_SUCH_TABLE") ||
          error.message.includes("ENOTFOUND") ||
          error.code === "ER_NO_SUCH_TABLE"
        ) {
          const createTableSQL = `
            CREATE TABLE ${DatabaseService._sanitizeTableName(
              REFERRAL_EARNINGS_TABLE
            )} (
              id INT AUTO_INCREMENT PRIMARY KEY,
              referrer_id INT NOT NULL,
              referee_id INT NOT NULL,
              amount BIGINT NOT NULL COMMENT 'Amount in cents',
              type TINYINT NOT NULL DEFAULT 2 COMMENT '1=first-time, 2=recurring',
              status VARCHAR(50) NOT NULL DEFAULT 'pending' COMMENT 'pending, approved, paid',
              subscription_id VARCHAR(255) NOT NULL COMMENT 'Stripe subscription ID',
              subscription_period_start DATETIME NOT NULL COMMENT 'When this subscription period started',
              subscription_period_end DATETIME NOT NULL COMMENT 'When this subscription period ends',
              stripe_payout_id VARCHAR(255) NULL COMMENT 'Stripe payout ID when paid',
              paid_at DATETIME NULL COMMENT 'When the payout was processed',
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              INDEX idx_referrer_id (referrer_id),
              INDEX idx_referee_id (referee_id),
              INDEX idx_status (status),
              INDEX idx_type (type),
              INDEX idx_subscription_id (subscription_id),
              INDEX idx_subscription_period (subscription_period_start, subscription_period_end)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `;

          await DatabaseService.query(createTableSQL);
          console.log(
            `Created referral_earnings table for namespace: ${namespace}`
          );
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error("Error ensuring referral_earnings table:", error);
      throw new Error("Failed to create or verify referral earnings table");
    }
  }

  async ensureStripeConnectionsTable(namespace) {
    try {
      // First, try to query the table to see if it exists
      try {
        await DatabaseService.query(
          `SELECT 1 FROM ${DatabaseService._sanitizeTableName(
            STRIPE_CONNECTIONS_TABLE
          )} LIMIT 1`
        );
        return; // Table exists
      } catch (error) {
        // Table doesn't exist, create it
        if (
          error.message.includes("doesn't exist") ||
          error.message.includes("Table") ||
          error.message.includes("ER_NO_SUCH_TABLE") ||
          error.message.includes("ENOTFOUND") ||
          error.code === "ER_NO_SUCH_TABLE"
        ) {
          const createTableSQL = `
            CREATE TABLE ${DatabaseService._sanitizeTableName(
              STRIPE_CONNECTIONS_TABLE
            )} (
              id INT AUTO_INCREMENT PRIMARY KEY,
              user_id INT NOT NULL,
              stripe_user_id VARCHAR(255) NOT NULL UNIQUE,
              stripe_access_token TEXT NOT NULL,
              stripe_refresh_token TEXT,
              stripe_scope VARCHAR(255),
              stripe_account_type VARCHAR(50),
              connected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              INDEX idx_user_id (user_id),
              INDEX idx_stripe_user_id (stripe_user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `;

          await DatabaseService.query(createTableSQL);
          console.log(
            `Created stripe_connections table for namespace: ${namespace}`
          );
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error("Error ensuring stripe_connections table:", error);
      throw new Error("Failed to create or verify stripe connections table");
    }
  }

  /**
   * Stores Stripe connection details
   * @param {Object} connectionData - Stripe connection information
   * @param {string} namespace - Dynamic namespace
   */
  async storeStripeConnection(connectionData, namespace) {
    try {
      await this.ensureStripeConnectionsTable(namespace);

      // Use new format without is_active column
      const query = `
          INSERT INTO ${DatabaseService._sanitizeTableName(
            STRIPE_CONNECTIONS_TABLE
          )} 
          (user_id, stripe_user_id, stripe_access_token, stripe_refresh_token, stripe_scope, stripe_account_type)
          VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
          stripe_access_token = VALUES(stripe_access_token),
          stripe_refresh_token = VALUES(stripe_refresh_token),
          stripe_scope = VALUES(stripe_scope),
          stripe_account_type = VALUES(stripe_account_type),
          updated_at = CURRENT_TIMESTAMP
        `;

      await DatabaseService.query(query, [
        connectionData.userId,
        connectionData.stripeUserId,
        EncryptionHelper.encrypt(connectionData.accessToken),
        connectionData.refreshToken
          ? EncryptionHelper.encrypt(connectionData.refreshToken)
          : null,
        connectionData.scope || null,
        connectionData.accountType || "standard",
      ]);
    } catch (error) {
      console.error("Error storing Stripe connection:", error);
      throw new Error("Failed to store Stripe connection");
    }
  }

  /**
   * Gets active Stripe connection for user
   * @param {number} userId - User ID
   * @param {string} namespace - Dynamic namespace
   * @returns {Object|null} Connection data or null
   */
  async getStripeConnection(userId, namespace) {
    try {
      // Use new format without is_active filter (all records are active)
      const query = `
          SELECT * FROM ${DatabaseService._sanitizeTableName(
            STRIPE_CONNECTIONS_TABLE
          )} 
          WHERE user_id = ? 
          ORDER BY connected_at DESC 
          LIMIT 1
        `;

      const results = await DatabaseService.query(query, [userId]);

      if (results.length > 0) {
        const connection = results[0];
        // Decrypt tokens before returning
        return {
          ...connection,
          stripe_access_token: EncryptionHelper.safeDecrypt(
            connection.stripe_access_token
          ),
          stripe_refresh_token: connection.stripe_refresh_token
            ? EncryptionHelper.safeDecrypt(connection.stripe_refresh_token)
            : null,
        };
      }

      return null;
    } catch (error) {
      console.error("Error getting Stripe connection:", error);
      return null;
    }
  }

  /**
   * Disconnects a Stripe account by completely deleting the connection record
   * @param {number} userId - User ID
   * @param {string} namespace - Dynamic namespace
   * @returns {Object} Disconnection result
   */
  async disconnectStripeAccount(userId, namespace) {
    try {
      // New format: delete all connections for this user
      const deleteQuery = `
          DELETE FROM ${DatabaseService._sanitizeTableName(
            STRIPE_CONNECTIONS_TABLE
          )} 
          WHERE user_id = ?
        `;

      const result = await DatabaseService.query(deleteQuery, [userId]);

      return {
        success: true,
        message: "Stripe account disconnected successfully",
        affectedRows: result.affectedRows || 0,
      };
    } catch (error) {
      console.error("Error disconnecting Stripe account:", error);
      throw new Error("Failed to disconnect Stripe account");
    }
  }

  /**
   * Check if connected account is verified and capable of receiving payouts
   * @param {string} stripeAccountId - Connected Stripe account ID
   * @returns {Promise<Object>} Account verification status
   */
  async checkAccountVerificationStatus(stripeAccountId) {
    try {
      if (!stripeAccountId) {
        throw new Error("Stripe account ID is required");
      }

      // Retrieve account details from Stripe
      const account = await this.stripe.accounts.retrieve(stripeAccountId);

      // Check if payouts are enabled
      const payoutsEnabled = account.payouts_enabled;

      // Check if charges are enabled (indicates full verification)
      const chargesEnabled = account.charges_enabled;

      // Check capabilities
      const hasTransfersCapability =
        account.capabilities?.transfers === "active";

      // Check for pending requirements
      const hasPendingRequirements =
        account.requirements?.currently_due?.length > 0 ||
        account.requirements?.past_due?.length > 0;

      // Check external accounts (bank accounts) for payouts
      const externalAccounts = await this.stripe.accounts.listExternalAccounts(
        stripeAccountId,
        { object: "bank_account", limit: 1 }
      );

      const hasBankAccount = externalAccounts.data.length > 0;

      return {
        success: true,
        account: {
          id: account.id,
          email: account.email,
          payouts_enabled: payoutsEnabled,
          charges_enabled: chargesEnabled,
          has_transfers_capability: hasTransfersCapability,
          has_pending_requirements: hasPendingRequirements,
          has_bank_account: hasBankAccount,
          country: account.country,
          business_type: account.business_type,
          requirements: {
            currently_due: account.requirements?.currently_due || [],
            past_due: account.requirements?.past_due || [],
            disabled_reason: account.requirements?.disabled_reason || null,
          },
        },
        canReceivePayouts:
          payoutsEnabled && !hasPendingRequirements && hasBankAccount,
      };
    } catch (error) {
      console.error("Error checking account verification status:", error);

      // Handle specific Stripe errors
      if (error.type === "StripeInvalidRequestError") {
        if (error.message.includes("No such account")) {
          throw new Error("Connected account not found");
        }
        throw new Error(`Invalid account request: ${error.message}`);
      }

      if (error.type === "StripePermissionError") {
        throw new Error("Access denied to this account");
      }

      throw new Error(`Failed to verify account status: ${error.message}`);
    }
  }

  /**
   * Get connected account basic information including email
   * @param {string} stripeAccountId - Connected Stripe account ID
   * @returns {Promise<Object>} Account information
   */
  async getConnectedAccountInfo(stripeAccountId) {
    try {
      if (!stripeAccountId) {
        throw new Error("Stripe account ID is required");
      }

      // Retrieve account details from Stripe
      const account = await this.stripe.accounts.retrieve(stripeAccountId);

      return {
        success: true,
        account: {
          id: account.id,
          email: account.email,
          country: account.country,
          business_type: account.business_type,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          created: account.created,
        },
      };
    } catch (error) {
      console.error("Error getting connected account info:", error);

      // Handle specific Stripe errors
      if (error.type === "StripeInvalidRequestError") {
        if (error.message.includes("No such account")) {
          throw new Error("Connected account not found");
        }
        throw new Error(`Invalid account request: ${error.message}`);
      }

      if (error.type === "StripePermissionError") {
        throw new Error("Access denied to this account");
      }

      throw new Error(`Failed to get account information: ${error.message}`);
    }
  }

  /**
   * Check platform balance before making payouts
   * @param {number} amount - Amount in cents to check for
   * @param {string} currency - Currency code (default: USD)
   * @returns {Promise<Object>} Balance check result
   */
  async checkPlatformBalance(amount, currency = "usd") {
    try {
      if (!amount || typeof amount !== "number" || amount <= 0) {
        throw new Error("Amount must be a positive number");
      }

      // Get platform balance
      const balance = await this.stripe.balance.retrieve();

      // Find available balance for the specified currency
      const availableBalance = balance.available.find(
        (bal) => bal.currency.toLowerCase() === currency.toLowerCase()
      );

      if (!availableBalance) {
        return {
          success: false,
          hasEnoughBalance: false,
          availableAmount: 0,
          requestedAmount: amount,
          currency: currency.toUpperCase(),
          error: `No balance found for currency ${currency.toUpperCase()}`,
        };
      }

      const hasEnoughBalance = availableBalance.amount >= amount;

      return {
        success: true,
        hasEnoughBalance,
        availableAmount: availableBalance.amount,
        requestedAmount: amount,
        currency: currency.toUpperCase(),
        balanceDetails: {
          available: balance.available,
          pending: balance.pending,
        },
      };
    } catch (error) {
      console.error("Error checking platform balance:", error);
      throw new Error(`Failed to check platform balance: ${error.message}`);
    }
  }

  /**
   * Create payout to connected account
   * @param {string} stripeAccountId - Connected Stripe account ID
   * @param {number} amount - Amount in cents
   * @param {string} currency - Currency code
   * @param {Object} metadata - Payout metadata
   * @returns {Promise<Object>} Payout result
   */
  async createPayout(stripeAccountId, amount, currency = "usd", metadata = {}) {
    try {
      if (!stripeAccountId) {
        throw new Error("Stripe account ID is required");
      }

      if (!amount || typeof amount !== "number" || amount <= 0) {
        throw new Error("Amount must be a positive number");
      }

      // Create payout
      const payout = await this.stripe.payouts.create(
        {
          amount: Math.round(amount), // Ensure integer
          currency: currency.toLowerCase(),
          description: `Referral earnings payout - ${new Date().toISOString()}`,
          metadata: {
            ...metadata,
            payout_type: "referral_earnings",
            created_at: new Date().toISOString(),
          },
        },
        {
          stripeAccount: stripeAccountId,
        }
      );

      return {
        success: true,
        payout: {
          id: payout.id,
          amount: payout.amount,
          currency: payout.currency,
          status: payout.status,
          arrival_date: payout.arrival_date,
          description: payout.description,
          created: payout.created,
          metadata: payout.metadata,
        },
      };
    } catch (error) {
      console.error("Error creating payout:", error);

      // Handle specific Stripe errors
      if (error.type === "StripeInvalidRequestError") {
        if (error.message.includes("Insufficient funds")) {
          throw new Error("Insufficient funds in platform account for payout");
        }
        if (error.message.includes("No such account")) {
          throw new Error("Connected account not found");
        }
        if (error.message.includes("payouts are not enabled")) {
          throw new Error("Payouts are not enabled for this account");
        }
        throw new Error(`Invalid payout request: ${error.message}`);
      }

      if (error.type === "StripePermissionError") {
        throw new Error("Access denied for payout operation");
      }

      throw new Error(`Failed to create payout: ${error.message}`);
    }
  }

  /**
   * Get approved referral earnings for a user
   * @param {number} userId - User ID
   * @param {string} namespace - Database namespace
   * @returns {Promise<Object>} Referral earnings data
   */
  async getApprovedReferralEarnings(userId, namespace) {
    try {
      if (!userId || typeof userId !== "number") {
        throw new Error("Valid user ID is required");
      }

      // Set namespace for database operations
      DatabaseService.setNamespace(namespace);

      // Ensure referral earnings table exists
      await this.ensureReferralEarningsTable(namespace);

      // Get all approved referral earnings for the user
      const approvedEarnings = await DatabaseService.find(
        REFERRAL_EARNINGS_TABLE,
        {
          where: {
            referrer_id: userId,
            status: "approved",
          },
          orderBy: {
            created_at: "ASC",
          },
        }
      );

      if (approvedEarnings.length === 0) {
        return {
          success: true,
          earnings: [],
          totalAmount: 0,
          totalCount: 0,
          currency: "USD",
        };
      }

      // Calculate total amount
      const totalAmount = approvedEarnings.reduce((sum, earning) => {
        // return sum + (parseInt(earning.amount) || 0);
        return sum + Number(earning.amount || 0);
      }, 0);

      return {
        success: true,
        earnings: approvedEarnings,
        totalAmount,
        totalCount: approvedEarnings.length,
        currency: "USD",
      };
    } catch (error) {
      console.error("Error getting approved referral earnings:", error);
      throw new Error(`Failed to get referral earnings: ${error.message}`);
    }
  }

  /**
   * Mark referral earnings as paid
   * @param {Array} earningIds - Array of earning IDs to mark as paid
   * @param {string} payoutId - Stripe payout ID
   * @param {string} namespace - Database namespace
   * @returns {Promise<Object>} Update result
   */
  async markReferralEarningsAsPaid(earningIds, payoutId, namespace) {
    try {
      if (!Array.isArray(earningIds) || earningIds.length === 0) {
        throw new Error("Earning IDs array is required");
      }

      if (!payoutId || typeof payoutId !== "string") {
        throw new Error("Payout ID is required");
      }

      // Set namespace for database operations
      DatabaseService.setNamespace(namespace);

      // Update all earnings to paid status
      const updateData = {
        status: "paid",
        stripe_payout_id: payoutId,
        paid_at: new Date(),
        updated_at: new Date(),
      };

      let totalUpdated = 0;

      // Update in batches to avoid large queries
      const batchSize = 50;
      for (let i = 0; i < earningIds.length; i += batchSize) {
        const batch = earningIds.slice(i, i + batchSize);

        const result = await DatabaseService.update(
          REFERRAL_EARNINGS_TABLE,
          updateData,
          {
            id: batch,
            status: "approved", // Only update if still approved (safety check)
          }
        );

        totalUpdated += result.affectedRows || 0;
      }

      return {
        success: true,
        updatedCount: totalUpdated,
        payoutId,
        expectedCount: earningIds.length,
      };
    } catch (error) {
      console.error("Error marking referral earnings as paid:", error);
      throw new Error(`Failed to update referral earnings: ${error.message}`);
    }
  }

  /**
   * Send support notification email for insufficient balance
   * @param {Object} userData - User data
   * @param {Object} payoutDetails - Payout attempt details
   * @param {string} namespace - Database namespace
   * @returns {Promise<Object>} Email send result
   */
  async sendInsufficientBalanceNotification(
    userData,
    payoutDetails,
    namespace
  ) {
    try {
      // Validate inputs before calling template generation
      if (!userData || !userData.user || !payoutDetails || !namespace) {
        throw new Error(
          "Required parameters missing for insufficient balance notification"
        );
      }

      // Use the new email template from EmailTemplateService
      const emailTemplate =
        EmailTemplateService.generatePlatformInsufficientBalanceNotificationTemplate(
          userData,
          payoutDetails,
          namespace
        );

      const emailData = {
        recipient: "support@mytechpassport.com",
        subject: emailTemplate.subject,
        body: emailTemplate.body,
        replyTo: process.env.BREVO_REPLY_TO || "noreply@mytechpassport.com",
        metadata: {
          type: "insufficient_balance_notification",
          userId: String(userData.user.id),
          namespace: namespace,
          requestedAmount: payoutDetails.requestedAmount,
          currency: payoutDetails.currency,
        },
      };

      // Send email using EmailService with SMTP provider
      const emailResult = await EmailService.sendEmail(
        1, // Use system user ID for support emails
        emailData,
        {
          provider: "smtp",
          skipFallback: true,
        },
        namespace
      );

      return {
        success: emailResult.success,
        message: "Support notification sent successfully",
      };
    } catch (error) {
      console.error("Error sending insufficient balance notification:", error);
      // Don't throw here as this is a secondary operation
      return {
        success: false,
        message: `Failed to send support notification: ${error.message}`,
      };
    }
  }

  /**
   * Send support notification email for successful payout but failed database update
   * @param {Object} userData - User data containing user and userMeta
   * @param {Object} payoutDetails - Successful payout details
   * @param {Array} earningsData - Array of referral earnings that should have been updated
   * @param {string} namespace - Database namespace
   * @param {string} errorMessage - The database error message
   * @returns {Promise<Object>} Email send result
   */
  async sendPayoutSuccessDatabaseFailureNotification(
    userData,
    payoutDetails,
    earningsData,
    namespace,
    errorMessage
  ) {
    try {
      // Validate inputs before calling template generation
      if (
        !userData ||
        !userData.user ||
        !payoutDetails ||
        !payoutDetails.payoutId ||
        !Array.isArray(earningsData) ||
        earningsData.length === 0 ||
        !namespace ||
        !errorMessage
      ) {
        throw new Error(
          "Required parameters missing for payout success database failure notification"
        );
      }

      // Use the new email template from EmailTemplateService
      const emailTemplate =
        EmailTemplateService.generatePlatformPayoutSuccessButDatabaseFailureTemplate(
          userData,
          payoutDetails,
          earningsData,
          namespace,
          errorMessage
        );

      const emailData = {
        recipient: "support@mytechpassport.com",
        subject: emailTemplate.subject,
        body: emailTemplate.body,
        replyTo: process.env.BREVO_REPLY_TO || "noreply@mytechpassport.com",
        metadata: {
          type: "payout_success_database_failure",
          userId: String(userData.user.id),
          namespace: namespace,
          payoutId: payoutDetails.payoutId,
          earningsCount: earningsData.length,
          critical: "true",
        },
      };

      // Send email using EmailService with SMTP provider - mark as critical
      const emailResult = await EmailService.sendEmail(
        1, // Use system user ID for support emails
        emailData,
        {
          provider: "smtp",
          skipFallback: true,
        },
        namespace
      );

      return {
        success: emailResult.success,
        message: "Critical support notification sent successfully",
      };
    } catch (error) {
      console.error(
        "Error sending payout success database failure notification:",
        error
      );
      // Don't throw here as this is a secondary operation, but log it as critical
      console.error(
        "CRITICAL: Failed to send database failure notification - manual intervention required"
      );
      return {
        success: false,
        message: `Failed to send critical support notification: ${error.message}`,
      };
    }
  }

  /**
   * Get actual amount paid considering external payments
   * @param {Object} invoice - Stripe invoice object
   * @returns {number} - Amount paid in cents
   */
  getActualAmountPaid(invoice) {
    // Check if invoice was paid out of band (external payment)
    if (invoice.paid_out_of_band === true) {
      // Try to get external payment amount from metadata
      const externalAmount = invoice.metadata?.external_payment_amount;

      if (externalAmount) {
        // Convert string to number and handle cents
        const numericAmount = Number(externalAmount);
        if (!isNaN(numericAmount) && numericAmount >= 0) {
          return numericAmount; // already in cents
        }
      }

      // Fallback to amount_paid if external amount doesn't exist or is invalid
      return invoice.amount_paid || 0;
    }

    // For regular Stripe payments, use amount_paid
    return invoice.amount_paid || 0;
  }

  /**
   * Calculates invoice totals and revenue metrics
   * @param {string} stripeAccountId - Connected Stripe account ID
   * @param {string} namespace - Dynamic namespace
   * @returns {Object} Revenue metrics
   */
  async calculateRevenueTotals(stripeAccountId, namespace) {
    try {
      // Get all paid invoices
      const paidInvoices = await this.getAllInvoicesWithStatus(
        stripeAccountId,
        namespace,
        "paid"
      );
      console.log("paidInvoices", paidInvoices.length);

      // Get all open invoices
      const openInvoices = await this.getAllInvoicesWithStatus(
        stripeAccountId,
        namespace,
        "open"
      );
      console.log("openInvoices", openInvoices.length);

      // Get all invoices for total count
      //   const allInvoices = await this.getAllInvoicesWithStatus(
      //     stripeAccountId,
      //     namespace
      //   );

      // Calculate total revenue from paid invoices
      const totalRevenue = paidInvoices.reduce(
        (sum, invoice) => sum + this.getActualAmountPaid(invoice),
        0
      );

      // Calculate total outstanding from open invoices
      const totalOutstanding = openInvoices.reduce(
        (sum, invoice) => sum + invoice.amount_remaining,
        0
      );

      // Calculate overdue amount
      const now = Math.floor(Date.now() / 1000);
      const totalOverdue = openInvoices
        .filter((invoice) => invoice.due_date && invoice.due_date < now)
        .reduce((sum, invoice) => sum + invoice.amount_remaining, 0);

      return {
        success: true,
        metrics: {
          totalRevenue, // Total amount collected from all paid invoices
          totalOutstanding, // Total amount not yet paid
          totalOverdue, // Total amount overdue
          //   invoiceCount: allInvoices.length,
          //   paidInvoiceCount: paidInvoices.length,
          //   paidPercentage:
          //     allInvoices.length > 0
          //       ? Math.round((paidInvoices.length / allInvoices.length) * 100)
          //       : 0,
          //   averageInvoiceValue:
          //     paidInvoices.length > 0
          //       ? Math.round(totalRevenue / paidInvoices.length)
          //       : 0,
        },
      };
    } catch (error) {
      console.error("Error calculating revenue totals:", error);
      throw new Error(`Failed to calculate revenue metrics: ${error.message}`);
    }
  }

  async getAllInvoicesWithStatus(stripeAccountId, namespace, status = null) {
    try {
      let allInvoices = [];
      let hasMore = true;
      let startingAfter = null;

      while (hasMore) {
        // Properly structure Stripe API options
        const params = {
          limit: 100,
          expand: ["data.customer", "data.payment_intent"],
        };

        if (startingAfter) {
          params.starting_after = startingAfter;
        }

        if (status) {
          params.status = status;
        }

        // Get invoices from Stripe
        const result = await this.stripe.invoices.list(params, {
          stripeAccount: stripeAccountId,
        });

        // Filter results based on our criteria
        const filteredInvoices = result.data.filter(
          (invoice) =>
            invoice.metadata &&
            invoice.metadata.created_by === namespace &&
            invoice.metadata.created_from_platform === "true"
        );

        allInvoices = [...allInvoices, ...filteredInvoices];
        hasMore = result.has_more && result.data.length > 0;

        if (hasMore) {
          startingAfter = result.data[result.data.length - 1].id;
        }
      }

      return allInvoices;
    } catch (error) {
      console.error("Error fetching all invoices:", error);
      throw error;
    }
  }
}

module.exports = new StripeService();
