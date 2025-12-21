const DatabaseService = require('../services/DatabaseService');
const StripeService = require('../services/StripeService');
const S3Service = require('../services/S3Service');

/**
 * Example of a "Complicated" API route definition.
 * Even if the 'real' implementation is complex, the 'mock' stays simple
 * so the frontend can keep moving.
 */
module.exports = [
  {
    path: '/transactions/process',
    method: 'POST',
    capability: 'transactions:write',
    // MOCK: Frontend gets an immediate success response with typical data
    mock: async (req) => ({
      transactionId: 'txn_' + Math.random().toString(36).substr(2, 9),
      status: 'completed',
      amount: req.body.amount || 100,
      currency: 'usd',
      receiptUrl: 'https://example.com/mock-receipt.pdf'
    }),
    // REAL: Complex orchestration logic
    real: async (req) => {
      const { amount, userId, fileData } = req.body;

      // 1. Check user status
      const user = await DatabaseService.findOne('users', { where: { id: userId } });
      if (!user) throw new Error('User not found');

      // 2. Process payment via Stripe
      const payment = await StripeService.createCharge(amount, 'usd', 'Transaction for ' + userId);

      // 3. Upload receipt/invoice to S3 if provided
      let receiptUrl = null;
      if (fileData) {
        receiptUrl = await S3Service.uploadFile('receipts', `${userId}-${Date.now()}.pdf`, fileData);
      }

      // 4. Save to Database
      const transaction = await DatabaseService.create('transactions', {
        userId,
        stripeId: payment.id,
        amount,
        status: 'completed',
        receiptUrl
      });

      return transaction;
    }
  }
];

