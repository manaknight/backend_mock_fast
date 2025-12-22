# Quick Fast Hybrid API Plan (Tenant-First)

## Goal
A multi-tenant system to rapidly spin up APIs for 100+ projects on a single backend. Each project has its own mock data that can be switched to real implementations via a toggle.

---

## 1. Unified Route Definition (The "AI-Friendly" Structure)
Instead of scattered routes, we use a structured definition. This is easy for AI to parse and "backward fill".

### Multi-Tenant Architecture
The system is built to host many isolated projects simultaneously.
- **Project Isolation:** Each project lives in `projects/[projectId]/`.
- **Automatic Namespacing:** Database tables are automatically prefixed with the project ID (e.g., `alpha_users`) via `TenantDatabaseService`.
- **Zero-Config Loading:** The `TenantManager` auto-discovers and registers project routes at `/api/[projectId]/[path]`.

```javascript
// Example: projects/alpha/routes/userRoutes.js
{
  path: '/users',
  method: 'GET',
  capability: 'users:read',
  schema: UserListSchema,
  mock: (req) => MockDataService.list(() => MockDataService.user(), 5),
  real: async (req, db) => {
    // 'db' is automatically namespaced to 'alpha'
    return await db.find('users');
  }
}
```

---

## 2. Global & Local Toggling
- **Global:** `MOCK_MODE=true` in `.env` forces all projects to use `mock` implementations.
- **Local:** Individual route overrides (e.g., `{ forceMock: true }`).
- **Latency:** `MOCK_LATENCY=300` in `.env` simulates network delay for all mocks.

---

## 3. Implementation Components

### A. `core/TenantManager.js`
The brain of the system. It scans the `projects/` directory, loads configs, and registers routes dynamically. It ensures that Project A cannot collide with Project B.

### B. `core/RouterFactory.js`
Generates Express routers. It handles:
1. **Mock vs Real** switching logic.
2. **Auth/Capability** middleware injection.
3. **Request/Response Validation** via Zod schemas.
4. **DB Injection:** Injects the namespaced `db` into `real` functions.

### C. `core/TenantDatabaseService.js`
A proxy that wraps `DatabaseService`. It intercepts calls and prefixes table names with the `projectId`.

### D. `services/MockDataService.js`
Provides "Smart Mocks". Includes an in-memory "Mock DB" (`persist`, `findAll`, `findById`) to maintain state during a development session.

---

## 4. Usage Guide

### 1. Create a New Project
Use the scaffolding script to create a project-specific route:
```bash
# Create project folder first
mkdir -p projects/beta/routes

# Generate a route inside that project
node scripts/generate-route.js Product beta
```

### 2. Verify Project Safety
Before deploying or restarting, check if the project code follows the framework rules:
```bash
node scripts/verify-project.js beta
```

### 3. Registering Shared Routes (Optional)
If you have APIs that all projects share, put them in the root `routes/` folder. They will be auto-discovered and registered under `/api/[path]`.

---

## 5. AI Implementation Workflow (Best Way)

To have an AI implement a full feature for a specific project:

1.  **Context:** Run `node scripts/dump-context.js` and upload `api_context_for_ai.txt`.
2.  **Prompt:**
    > "I am working on project 'delta'.
    > 1. Create `projects/delta/routes/orderRoutes.js`.
    > 2. I need `GET /orders` and `POST /orders`.
    > 3. Use Zod for validation.
    > 4. In `real`, use the namespaced `db` to save to the 'orders' table.
    > 5. In `mock`, use `MockDataService` to return a list of 5 realistic orders."

### Schema Decision Process

The AI should analyze business requirements and define:

1. **Zod Response Schemas** - For API contract validation:
   ```javascript
   const OrderSchema = z.object({
     id: z.string(),
     customerId: z.string(),
     total: z.number().positive(),
     status: z.enum(['pending', 'paid', 'shipped', 'delivered']),
     items: z.array(z.object({
       productId: z.string(),
       quantity: z.number().int().positive(),
       price: z.number().positive()
     })),
     createdAt: z.string().datetime()
   });
   ```

2. **Request Validation Schemas** - For input validation:
   ```javascript
   requestSchema: {
     body: z.object({
       customerId: z.string(),
       items: z.array(z.object({
         productId: z.string(),
         quantity: z.number().int().min(1)
       }))
     })
   }
   ```

3. **Mock Data Generators** - Realistic test data that matches schemas.

### MySQL Migration Process

**Current State:** No automated migrations. Tables must be pre-created.

**Manual Migration Steps:**
1. **Design Schema** based on Zod schemas:
   ```sql
   CREATE TABLE delta_orders (
     id VARCHAR(36) PRIMARY KEY,
     customer_id VARCHAR(36) NOT NULL,
     total DECIMAL(10,2) NOT NULL,
     status ENUM('pending', 'paid', 'shipped', 'delivered') DEFAULT 'pending',
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     INDEX idx_customer (customer_id),
     INDEX idx_status (status)
   );
   ```

2. **Create Related Tables** for nested objects:
   ```sql
   CREATE TABLE delta_order_items (
     id VARCHAR(36) PRIMARY KEY,
     order_id VARCHAR(36) NOT NULL,
     product_id VARCHAR(36) NOT NULL,
     quantity INT NOT NULL,
     price DECIMAL(10,2) NOT NULL,
     FOREIGN KEY (order_id) REFERENCES delta_orders(id),
     INDEX idx_order (order_id)
   );
   ```

3. **Test Real Implementation** after table creation:
   - Use `DatabaseService.find()`, `insert()`, etc.
   - Verify tenant namespacing works (`delta_orders`, not just `orders`)

---

## 6. Zero-Code Capabilities (2025 Vision) ⚡

### A. SchemaIntelligenceService - One Schema, Everything Generated

**Input:** Single Zod schema definition
**Output:** Complete backend infrastructure

```javascript
// One source of truth
const OrderSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string(),
  total: z.number().positive(),
  status: z.enum(['pending','paid','shipped','delivered']),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().int().positive(),
    price: z.number().positive()
  })),
  createdAt: z.string().datetime()
});

// Automatically generates:
// ✅ SQL DDL: CREATE TABLE delta_orders (...)
// ✅ Indexes: PRIMARY KEY, FOREIGN KEYS, performance indexes
// ✅ Mock Generators: realisticOrder(), realisticOrderList()
// ✅ OpenAPI Docs: /docs endpoint with full spec
// ✅ Validation Middleware: Zod-based request/response validation
// ✅ Test Fixtures: valid/invalid data for testing
```

### B. AutoCRUDRouter - Default CRUD (Zero Route Code)

**Input:** Minimal route definition
**Output:** Full REST API

```javascript
// Before: 50+ lines of route definitions
{
  path: '/orders',
  method: 'GET',
  capability: 'orders:read',
  mock: () => MockDataService.list(() => MockDataService.order(), 5),
  real: async (req, db) => await db.find('orders')
},
{
  path: '/orders/:id',
  method: 'GET',
  // ... more routes
}

// After: 5 lines
{
  resource: 'orders',
  schema: OrderSchema,
  capabilities: {
    list: 'orders:read',
    create: 'orders:write',
    read: 'orders:read',
    update: 'orders:write',
    delete: 'orders:write'
  }
}
```

**Automatically provides:**
- `GET /orders` - List with pagination, filtering, sorting
- `GET /orders/:id` - Single record
- `POST /orders` - Create with validation
- `PATCH /orders/:id` - Update with validation
- `DELETE /orders/:id` - Delete

### C. QueryDSL - No Custom Filtering Logic

**Input:** Natural query strings
**Output:** Optimized database queries

```javascript
// Clients send:
GET /orders?status=paid&total>100&sort=-createdAt&limit=20&page=1

// Automatically becomes:
{
  where: {
    status: 'paid',
    total: { operator: '>', value: 100 }
  },
  orderBy: { createdAt: 'DESC' },
  limit: 20,
  offset: 0
}

// With automatic:
// ✅ Query validation
// ✅ SQL injection prevention
// ✅ Index suggestions
// ✅ Performance optimization
```

### D. Built-in Admin Console - Zero Dev Tooling

**Access:** `http://localhost:3000/admin`
**Security:** Tenant-scoped access control

**Role-Based Access:**
- **SuperAdmin** 👑 - Global system access (all tenants)
- **Admin** 🏢 - Tenant-scoped access (own tenant only)
- **Member/Support** ❌ - No admin access

**Features (Scoped by Role):**
- 📊 **System Dashboard** - Tenants, routes, schemas, request counts (filtered by access)
- 🏗️ **Tenant Browser** - View projects and routes (SuperAdmin: all, Admin: own tenant)
- 🛣️ **Route Explorer** - All endpoints with capabilities (filtered by tenant)
- 📋 **Schema Manager** - View/generate SQL DDL, indexes, OpenAPI specs (tenant-scoped)
- 📊 **Live Database Browser** - Query tables, view data (tenant-scoped access only)
- 📈 **Request Logger** - Real-time API monitoring with latency (tenant-scoped)
- 🎛️ **Mock Controls** - Toggle mock mode, simulate latency (scoped permissions)
- 🔧 **Schema Generator** - One-click SQL generation (tenant-scoped)

### E. Lifecycle Hooks - Extensibility

**Hook Points:**
- `beforeCreate` / `afterCreate`
- `beforeRead` / `afterRead`
- `beforeUpdate` / `afterUpdate`
- `beforeDelete` / `afterDelete`
- `beforeList` / `afterList`

```javascript
{
  resource: 'orders',
  schema: OrderSchema,
  capabilities: { /* ... */ },
  hooks: {
    beforeCreate: async (data, context) => {
      // Validate business rules
      if (data.total > 10000) throw new Error('Order too large');
      // Add audit fields
      data.createdBy = context.req.user.id;
    },
    afterCreate: async (result, context) => {
      // Send notifications
      await sendOrderConfirmation(result.id);
      // Update inventory
      await updateInventory(result.items);
    }
  }
}
```

🔐 Role-Based Access Control
1. SuperAdmin (Global System Admin)
Access: All tenants, all data, all operations
Capabilities: system:admin, tenants:manage, global:settings, cross_tenant:access
Use Case: System administrators managing the entire platform
2. Admin (Tenant-Scoped Admin)
Access: Only their own tenant's data and operations
Capabilities: tenant:admin, tenant:settings, tenant:data:manage
Use Case: Project managers administering their specific project
3. Member/Support (No Admin Access)
Access: Regular API access only
Capabilities: Standard user permissions

-- Users table now includes tenant_id
ALTER TABLE users ADD COLUMN tenant_id VARCHAR(50) NOT NULL;

// Extracts tenant info from JWT and database
req.user = {
  id: user.id,
  email: user.email,
  role: user.role,
  tenantId: user.tenant_id,  // ← New: For scoping decisions
  status: user.status
};