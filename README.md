# Quick Fast Hybrid API

A multi-tenant backend system that rapidly spins up APIs for 100+ projects with built-in mock/real data switching. Each project gets its own isolated namespace, automatic route registration, and seamless development/production toggling.

## 🚀 Key Features

- **Multi-Tenant Architecture**: Host multiple projects in isolation with automatic namespacing
- **Mock/Real Switching**: Toggle between mock data and real database implementations globally or per-route
- **Zero-Config Route Registration**: Auto-discover and register routes from project directories
- **Schema Validation**: Built-in Zod validation for request/response contracts
- **Capability-Based Auth**: Role-based access control with project-scoped permissions
- **Admin Console**: Built-in admin interface at `/admin` for monitoring and management
- **Smart Mocks**: Realistic mock data with in-memory persistence during development
- **Auto-Documentation**: Live API docs at `/api-docs`

## 📦 Installation

### Prerequisites

- Node.js (v14 or higher)
- MySQL database (for production/real mode)
- npm or yarn

### Install Dependencies

```bash
# Clone the repository
git clone <your-repo-url>
cd backend-mock-fast

# Install dependencies
npm install
```

## ⚙️ Setup

### 1. Environment Configuration

Copy the example environment file and configure your settings:

```bash
cp env.example .env
```

Edit `.env` with your configuration:

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# Database Configuration (required for real mode)
DB_HOST=localhost
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=your_database
DB_PORT=3306

# JWT Configuration
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRES_IN=7d

# Development Mode
MOCK_MODE=true  # Set to false for production
MOCK_LATENCY=300  # Simulate network delay in mock mode (ms)
```

### 2. Database Setup (Optional - for real mode)

If using real database mode, create your database and tables:

```sql
CREATE DATABASE your_database;
-- Tables will be auto-created with project prefixes (e.g., alpha_users, beta_orders)
```

### 3. Start the Server

```bash
# Development mode (with mocks)
npm run dev

# Or explicitly set mock mode
MOCK_MODE=true npm start

# Production mode (real database)
MOCK_MODE=false npm start
```

The server will start on `http://localhost:3001` (or your configured PORT).

## 🏗️ Usage

### Creating a New Project

1. Create the project directory structure:
```bash
mkdir -p projects/myproject/routes
```

2. Create a basic project configuration:
```json
// projects/myproject/config.json
{
  "name": "My Project",
  "description": "A sample project",
  "database": "shared"  // or "isolated"
}
```

### Creating API Routes

Use the built-in generator to create route files:

```bash
# Generate a route file for the project
node scripts/generate-route.js Product myproject

# This creates: projects/myproject/routes/productRoutes.js
```

Example route definition:

```javascript
// projects/myproject/routes/productRoutes.js
const { z } = require('zod');

const ProductSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  price: z.number().positive(),
  category: z.string(),
  createdAt: z.string().datetime()
});

module.exports = [
  {
    path: '/products',
    method: 'GET',
    capability: 'products:read',
    schema: z.array(ProductSchema),
    mock: (req) => MockDataService.list(() => MockDataService.product(), 10),
    real: async (req, db) => await db.find('products')
  },
  {
    path: '/products',
    method: 'POST',
    capability: 'products:write',
    requestSchema: {
      body: z.object({
        name: z.string().min(1),
        price: z.number().positive(),
        category: z.string()
      })
    },
    responseSchema: ProductSchema,
    mock: (req) => ({ ...req.body, id: MockDataService.uuid(), createdAt: new Date().toISOString() }),
    real: async (req, db) => await db.insert('products', req.body)
  }
];
```

### API Endpoints

Routes are automatically namespaced by project:

- **Shared Routes**: `/api/products` (from root `routes/` directory)
- **Project Routes**: `/api/myproject/products` (from `projects/myproject/routes/`)

### Testing Your API

```bash
# Check server status
curl http://localhost:3001/

# View API documentation
curl http://localhost:3001/api-docs

# Access admin console (in browser)
open http://localhost:3001/admin

# Test a project endpoint
curl http://localhost:3001/api/myproject/products
```

## 🔧 Development Scripts

```bash
# Generate a new route
node scripts/generate-route.js ModelName [projectId]

# Verify project structure and safety
node scripts/verify-project.js [projectId]

# Dump context for AI development
node scripts/dump-context.js > api_context_for_ai.txt

# Run demo
node demo.js
```

## 🔄 Mock vs Real Mode

### Global Toggling

```bash
# Mock mode (development)
MOCK_MODE=true npm start

# Real mode (production)
MOCK_MODE=false npm start
```

### Per-Route Override

```javascript
{
  path: '/users',
  method: 'GET',
  forceMock: true,  // Always use mock, even in real mode
  // ... rest of route definition
}
```

### Mock Data Features

- **In-Memory Persistence**: Mock data persists during development sessions
- **Realistic Data**: Smart generators create believable test data
- **Latency Simulation**: Configurable network delay simulation
- **State Management**: Mock operations maintain referential integrity

## 🛡️ Authentication & Authorization

The system includes capability-based authentication:

### JWT Authentication

Routes automatically check for valid JWT tokens unless `noAuth: true` is set.

### Capability System

Define required capabilities per route:
```javascript
{
  capability: 'users:read',  // Required permission
  // ...
}
```

### Role-Based Access

- **SuperAdmin**: Global system access (all tenants)
- **Admin**: Tenant-scoped access (own project only)
- **Member/Support**: Regular API access only

## 📊 Admin Console

Access the built-in admin interface at `http://localhost:3001/admin` to:

- View system dashboard and tenant information
- Browse projects and routes
- Monitor live requests and performance
- Toggle mock modes and simulate latency
- Generate SQL schemas from Zod definitions
- Query live databases (tenant-scoped)

## 🏛️ Architecture

### Core Components

- **TenantManager**: Auto-discovers and loads project configurations
- **RouterFactory**: Creates Express routers with auth, validation, and mock/real switching
- **TenantDatabaseService**: Provides namespaced database access
- **MockDataService**: Generates and manages mock data
- **SchemaIntelligenceService**: Auto-generates SQL DDL and API specs

### Project Structure

```
projects/
├── alpha/
│   ├── config.json
│   └── routes/
│       ├── userRoutes.js
│       └── productRoutes.js
└── beta/
    ├── config.json
    └── routes/
        └── orderRoutes.js
```

## 🚀 Advanced Features

### Schema Intelligence (2025 Vision)

Define once, generate everything:

```javascript
const OrderSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string(),
  total: z.number().positive(),
  status: z.enum(['pending', 'paid', 'shipped', 'delivered']),
  // ... more fields
});

// Automatically generates:
// - SQL DDL for database tables
// - Mock data generators
// - OpenAPI documentation
// - Validation middleware
// - Test fixtures
```

### Auto-CRUD Router

Minimal route definition for full REST APIs:

```javascript
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

// Provides: GET /orders, POST /orders, GET /orders/:id, PATCH /orders/:id, DELETE /orders/:id
```

### Query DSL

Natural query string filtering:

```
GET /orders?status=paid&total>100&sort=-createdAt&limit=20&page=1
```

## 📚 API Documentation

Visit `/api-docs` for live documentation of all registered routes, including:
- Endpoint paths and methods
- Required capabilities
- Authentication requirements
- Schema validation status
- Route sources (shared vs project-specific)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `node scripts/verify-project.js` on test projects
5. Submit a pull request

## 📄 License

ISC
