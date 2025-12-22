This document contains the essential rules and patterns that AI assistants must follow when coding in this project. **Always reference these rules before making any code changes.**

## 🏗️ Project Architecture Overview

### Multi-Tenant System
- **Project Isolation**: Each project lives in `projects/[projectId]/` with automatic database namespacing (`alpha_users`, `beta_orders`)
- **Zero-Config Loading**: TenantManager auto-discovers projects and registers routes at `/api/[projectId]/[path]`
- **Shared Routes**: Routes in root `routes/` directory are shared across all projects at `/api/[path]`

### Mock/Real Switching
- **Global Toggle**: `MOCK_MODE=true` forces all routes to use mock implementations
- **Local Override**: `forceMock: true` on individual routes
- **Latency Simulation**: `MOCK_LATENCY=300` adds delay to mock responses
- **Headers**: All responses include `X-Implementation-Mode: MOCK|REAL`

## 📁 File Structure & Organization

### Directory Structure
```
projects/[projectId]/           # Project-specific code
├── config.json                # Project configuration
└── routes/                    # Project-specific routes
    └── [resource]Routes.js

routes/                        # Shared routes (all projects)
├── userRoutes.js
├── productRoutes.js
└── ...

core/                          # Core system components
├── RouterFactory.js           # Route generation & middleware
├── TenantManager.js           # Project auto-discovery
├── TenantDatabaseService.js   # Database namespacing
└── ...

middleware/                    # Express middleware
├── auth.js                    # JWT authentication
└── capability.js              # Capability-based authorization

services/                      # Business logic & utilities
├── DatabaseService.js         # MySQL operations
├── MockDataService.js         # Smart mock data generation
├── JWTService.js              # Token management
└── ...
```

## 🔀 Route Definition Pattern

### Standard Route Structure
```javascript
module.exports = [
  {
    path: '/resource',           // URL path (relative to project)
    method: 'GET',               // HTTP method
    capability: 'resource:read', // Required permission
    schema: ResponseSchema,      // Zod validation schema
    requestSchema: {             // Optional request validation
      body: BodySchema,
      query: QuerySchema,
      params: ParamsSchema
    },
    mock: (req) => {             // Mock implementation
      return MockDataService.list(() => MockDataService.resource(), 5);
    },
    real: async (req, db) => {   // Real database implementation
      return await db.find('resource');
    },
    noAuth: false,               // Skip authentication (default: false)
    forceMock: false,            // Always use mock (default: false)
    delay: 0                     // Custom mock delay override
  }
];
```

### AutoCRUD Route Structure (2025 Vision)
```javascript
{
  resource: 'orders',           // Resource name (plural)
  schema: OrderSchema,          // Zod response schema
  capabilities: {               // CRUD capabilities
    list: 'orders:read',
    create: 'orders:write',
    read: 'orders:read',
    update: 'orders:write',
    delete: 'orders:write'
  },
  hooks: {                      // Lifecycle hooks (optional)
    beforeCreate: async (data, context) => { /* validation */ },
    afterCreate: async (result, context) => { /* notifications */ }
  }
}
// Auto-generates: GET /orders, POST /orders, GET /orders/:id, PATCH /orders/:id, DELETE /orders/:id
```

## 📝 Zod Schema Patterns

### Response Schemas
```javascript
const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['Member', 'Admin', 'SuperAdmin']),
  avatar: z.string().url().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional()
});

const UserListSchema = z.array(UserSchema);
```

### Request Validation Schemas
```javascript
const CreateUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  role: z.enum(['Member', 'Admin']).optional().default('Member')
});

requestSchema: {
  body: CreateUserSchema,
  query: z.object({
    page: z.string().regex(/^\d+$/).transform(Number).optional(),
    limit: z.string().regex(/^\d+$/).transform(Number).optional()
  }),
  params: z.object({
    id: z.string().uuid()
  })
}
```

## 🔐 Authentication & Authorization

### JWT Authentication
- **Header**: `Authorization: Bearer <token>`
- **Verification**: Automatic via `auth.verifyToken` middleware
- **User Object**: `req.user = { id, email, role, status, tenantId, is_premium }`

### Capability-Based Authorization
```javascript
// Route-level capability check
capability: 'users:read'

// Middleware usage
const { requireCapability } = require('../middleware/capability');
router.get('/users', requireCapability('users:read'), handler);
```

### Role-Based Access
```javascript
const auth = require('../middleware/auth');

// Common patterns
auth.requireMember       // Member, Admin, Support
auth.requireAdmin        // Admin only (tenant-scoped)
auth.requireSuperAdmin   // SuperAdmin only (global)
auth.requirePremiumMember // Premium members only
```

### Capability Mapping
```javascript
// From core/Capability.js
const CAPABILITIES = {
  member: ['profile:read', 'profile:write'],
  admin: ['users:read', 'users:write', 'system:read'],
  superadmin: ['*'] // All capabilities
};
```

## 🗄️ Database Patterns

### Standard Operations
```javascript
// Find records
const users = await db.find('users', {
  where: { role: 'Admin', status: 'active' },
  orderBy: { createdAt: 'desc' },
  limit: 10,
  offset: 20,
  select: ['id', 'name', 'email']
});

// Find single record
const user = await db.findOne('users', {
  where: { id: userId }
});

// Create record
const newUser = await db.insert('users', {
  name: 'John Doe',
  email: 'john@example.com',
  role: 'Member'
});

// Update record
const updatedUser = await db.update('users', {
  where: { id: userId },
  data: { name: 'Jane Doe' }
});

// Delete record
const deletedCount = await db.delete('users', {
  where: { id: userId }
});
```

### Tenant-Aware Database Access
```javascript
// In project routes, 'db' parameter is auto-namespaced
real: async (req, db) => {
  // db.find('users') automatically queries 'projectId_users'
  return await db.find('users');
}
```

## 🎭 Mock Data Patterns

### MockDataService Usage
```javascript
const MockDataService = require('../services/MockDataService');

// Generate single entity
const user = MockDataService.user(); // { id, name, email, ... }

// Generate list
const users = MockDataService.list(() => MockDataService.user(), 5);

// Persist in memory (for stateful mocks)
const savedUser = MockDataService.persist('users', userData);

// Retrieve from memory
const storedUsers = MockDataService.findAll('users');
const user = MockDataService.findById('users', userId);
```

### Mock Implementation Examples
```javascript
// List with seeding
mock: () => {
  const stored = MockDataService.findAll('products');
  if (stored.length === 0) {
    const seeded = MockDataService.list(() => MockDataService.product(), 5);
    seeded.forEach(p => MockDataService.persist('products', p));
    return seeded;
  }
  return stored;
}

// Single entity with fallback
mock: (req) => {
  const product = MockDataService.findById('products', req.params.id);
  return product || MockDataService.product(req.params.id);
}

// Create with merge
mock: (req) => {
  const newProduct = {
    ...MockDataService.product(),
    ...req.body,
    createdAt: new Date().toISOString()
  };
  return MockDataService.persist('products', newProduct);
}
```

## 📜 Import Patterns

### Conditional Database Imports
```javascript
// Always use this pattern to avoid import errors in mock mode
let DatabaseService;
if (process.env.MOCK_MODE !== 'true') {
  DatabaseService = require('../services/DatabaseService');
}
const MockDataService = require('../services/MockDataService');
```

### Path Patterns by Location
```javascript
// In root routes/ directory
const DatabaseService = require('../services/DatabaseService');
const MockDataService = require('../services/MockDataService');

// In projects/[projectId]/routes/ directory
const DatabaseService = require('../../../services/DatabaseService');
const MockDataService = require('../../../services/MockDataService');
```

## 🛠️ Development Scripts

### Route Generation
```bash
# Generate shared route
node scripts/generate-route.js Product

# Generate project-specific route
node scripts/generate-route.js Product alpha
```

### Project Verification
```bash
# Verify project structure and safety
node scripts/verify-project.js alpha
```

### Context Dumping for AI
```bash
# Generate context for AI development
node scripts/dump-context.js > api_context_for_ai.txt
```

## 🎯 Error Handling & Response Format

### Standard Response Format
```javascript
// Success responses
{ success: true, data: resultData, _mock: true }

// Error responses
{
  success: false,
  error: 'ErrorType',
  message: 'Human readable message',
  details: validationErrors // Optional
}
```

### HTTP Status Codes
- `200` - Success
- `400` - Validation Error (with Zod details)
- `401` - Authentication Required
- `403` - Insufficient Permissions
- `404` - Not Found
- `500` - Server Error

## 🔧 Code Style & Conventions

### Naming Conventions
- **Files**: `camelCaseRoutes.js`, `PascalCaseService.js`
- **Variables**: `camelCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Database Tables**: `snake_case` (auto-prefixed with project ID)
- **API Paths**: `/kebab-case` or `/camelCase`

### JSDoc Comments
```javascript
/**
 * Description of function/class
 * @param {Type} paramName - Description
 * @returns {Type} - Description
 */
```

### Async/Await Always
```javascript
// ✅ Always use async/await
real: async (req, db) => {
  const users = await db.find('users');
  return users;
}

// ❌ Never use Promises directly
real: (req, db) => {
  return db.find('users').then(users => users);
}
```

## 🚀 AI Development Workflow

### When Implementing New Features

1. **Check Existing Patterns**: Look at similar routes in `routes/` or `projects/alpha/routes/`
2. **Use Zod Schemas**: Define proper validation schemas for requests and responses
3. **Implement Both Mock and Real**: Always provide both implementations
4. **Follow Capability Pattern**: Use appropriate `capability: 'resource:action'`
5. **Test Both Modes**: Ensure code works in `MOCK_MODE=true` and `MOCK_MODE=false`
6. **Verify with Scripts**: Run `node scripts/verify-project.js [projectId]` after changes

### Project-Specific Route Creation
```javascript
// Create: projects/delta/routes/orderRoutes.js
// Content follows standard route patterns
// TenantManager will auto-discover and register at /api/delta/orders
```

### Schema-Driven Development
```javascript
// 1. Define Zod schema first
const OrderSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string(),
  total: z.number().positive(),
  status: z.enum(['pending', 'paid', 'shipped', 'delivered'])
});

// 2. Use schema in routes
schema: OrderSchema,  // Response validation
requestSchema: { body: CreateOrderSchema }  // Request validation

// 3. Use in mock generation
mock: () => MockDataService.order()  // Assumes schema-aware generation
```

## ⚠️ Critical Rules (Never Break These)

1. **Always provide both `mock` and `real` implementations** in route definitions
2. **Never import DatabaseService directly** without conditional check in mock mode
3. **Always use tenant-aware `db` parameter** in project routes, never direct DatabaseService
4. **Always include proper Zod schemas** for request/response validation
5. **Always use capability-based authorization**, never role checks in route handlers
6. **Always follow the established file structure** and naming conventions
7. **Always test both MOCK_MODE=true and MOCK_MODE=false**
8. **Never modify core system files** without understanding the entire architecture
9. **Always run verification scripts** after making changes
10. **Always reference this document** before implementing any feature

## 🎯 Quick Reference Commands

```bash
# Start development server
npm run dev

# Test specific routes
curl http://localhost:3001/api/alpha/users

# View API documentation
open http://localhost:3001/api-docs

# Access admin console
open http://localhost:3001/admin

# Generate context for AI
node scripts/dump-context.js > context.txt
```

Remember: This system is designed for rapid API development with seamless mock/real switching. Always prioritize the established patterns over "improvements" unless you fully understand the multi-tenant architecture.
