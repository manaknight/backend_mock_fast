# Quick Fast Hybrid API Plan

## Goal
A system to rapidly spin up APIs with mock data that can be switched to real implementations via a toggle.

---

## 1. Unified Route Definition (The "AI-Friendly" Structure)
Instead of scattered routes, we use a structured definition. This is easy for AI to parse and "backward fill".

### Handling Complexity
For complicated APIs (e.g., payments, S3 uploads), keep the `mock` simple (returning the final expected object) and put the orchestration logic in `real`. This allows the frontend to be unblocked while the complex backend logic is developed.

```javascript
// Example: routes/userRoutes.js
{
  path: '/users/:id',
  method: 'GET',
  capability: 'users:read',
  mock: (req) => ({
    id: req.params.id,
    name: "Mock User",
    email: "mock@example.com"
  }),
  real: async (req) => {
    return await DatabaseService.findOne('users', { where: { id: req.params.id } });
  }
}
```

## 2. Global & Local Toggling
- **Global:** `MOCK_MODE=true` in `.env` forces all routes to use `mock` implementation.
- **Local:** Individual route overrides (e.g., `{ forceMock: true }`).

## 3. Implementation Components

### A. `core/RouterFactory.js`
A utility that:
1. Takes an array of route definitions.
2. Wraps them in auth/capability middleware automatically.
3. Injects logic to switch between `mock` and `real`.
4. Handles standard response formatting and error handling.
5. **Traceability:** Adds traceability headers (`X-Implementation-Mode: MOCK/REAL`).
6. **Response Validation:** Validates responses against Zod schemas (contract validation).
7. **Request Validation:** Validates `body`, `query`, and `params` before processing.
8. **Latency Simulation:** Simulates network delay for mocks.

### B. `services/MockDataService.js`
A helper to generate consistent fake data (e.g., `Mock.user()`, `Mock.uuid()`).
- **Stateful Mocks:** In-memory storage to persist data during a session (e.g., POSTing a user actually "saves" it to the mock list).

### C. Auto-Route Discovery
Server automatically scans `routes/` directory and registers all `*Routes.js` files.

### D. Auto-Generated Documentation
Provides an `/api-docs` endpoint showing all routes, methods, and expected schemas.

### E. AI-Ready Context
A script to export the entire API structure for easy sharing with LLMs for "backward filling" real logic.

---

## 4. Advanced Time-Saving Features

### Request Validation
You can now define `requestSchema` in your routes to validate `body`, `query`, or `params` using Zod. This catches frontend errors before they hit your logic.

### Latency Simulation
Set `MOCK_LATENCY=500` in `.env` to simulate a slow network for all mocks. This helps you build better loading states in the frontend.

### Stateful Mocks (Mock DB)
Use `MockDataService.persist()` to save data to an in-memory storage. This allows you to `POST` a user and then see it in the `GET /users` list immediately.

### Auto-Generated Docs
Visit `/api-docs` on your server to see a visual list of all registered routes, their methods, capabilities, and validation status.

---

## 5. Pros & Cons

### Pros
- **Instant Productivity:** Frontend can start immediately with `mock`.
- **Structured Development:** Forces clear separation of data requirements (mock) and logic (real).
- **AI-Native:** AI can see the `mock` data structure and easily write the SQL/Database logic for the `real` part.
- **Easy Testing:** Can test edge cases by temporarily modifying the `mock` return.
- **Zero-Config Route Registration:** Auto-discovery means new APIs are live instantly.
- **Contract Safety:** Zod validation prevents mock/real drift that could break frontend.
- **Smart Mocks:** Consistent fake data generation across all routes.

### Cons
- **Consistency Risk:** If the `mock` return and `real` return drift apart, frontend might break. (**SOLVED:** Contract validation with Zod schemas).
- **Overhead:** Small amount of extra code for the `RouterFactory` logic.

---

## 5. Implementation Status ✅ COMPLETE
- [x] **`core/RouterFactory.js`**: Centralized route handler with auth & mock/real logic.
- [x] **`MOCK_MODE` Toggle**: Global control via `.env`.
- [x] **`scripts/generate-route.js`**: CLI for instant route scaffolding.
- [x] **Examples**: `userRoutes.js`, `transactionRoutes.js`, and `productRoutes.js` implemented.
- [x] **`services/MockDataService.js`**: Smart mock data generation.
- [x] **Auto-Route Discovery**: Zero-config route registration.
- [x] **Contract Validation**: Zod schema enforcement.
- [x] **Traceability Headers**: `X-Implementation-Mode` response headers.
- [x] **Demo Script**: `node demo.js` shows everything working.
- [x] **Request Validation**: Incoming data validation via Zod.
- [x] **Latency Simulation**: Mock network delay.
- [x] **Stateful Mocks**: In-memory "Mock DB".
- [x] **Auto-Docs**: `/api-docs` endpoint.
- [x] **AI-Context**: `scripts/dump-context.js`.

## 6. Usage Guide

### Scaffolding a new API
To create a new set of routes (e.g., for "Post"):
```bash
node scripts/generate-route.js Post
```

### Registering Routes
In `server.js`:
```javascript
const postRoutes = require('./routes/postRoutes');
app.use('/api', RouterFactory.create(postRoutes));
```

### Toggling Mock Mode
Update `.env`:
```env
MOCK_MODE=true # Use mocks
# OR
MOCK_MODE=false # Use real implementations
```

### Running the Demo
```bash
# Start the server
MOCK_MODE=true node server.js

# In another terminal, run the demo
node demo.js
```

### Using Smart Mocks
```javascript
const MockDataService = require('./services/MockDataService');

// In your routes:
mock: (req) => MockDataService.user(req.params.id)
```

### Contract Validation
```javascript
const { z } = require('zod');

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email()
});

module.exports = [{
  path: '/users/:id',
  schema: UserSchema, // Both mock and real will be validated
  mock: (req) => ({ id: '1', name: 'John', email: 'john@example.com' }),
  real: async (req) => { /* database logic */ }
}];
```

### Auto-Route Discovery
Routes are automatically registered when you run the server. No manual registration needed in `server.js`!

