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

### B. `services/MockDataService.js`
A helper to generate consistent fake data (e.g., `Mock.user()`, `Mock.uuid()`).

---

## 4. Pros & Cons

### Pros
- **Instant Productivity:** Frontend can start immediately with `mock`.
- **Structured Development:** Forces clear separation of data requirements (mock) and logic (real).
- **AI-Native:** AI can see the `mock` data structure and easily write the SQL/Database logic for the `real` part.
- **Easy Testing:** Can test edge cases by temporarily modifying the `mock` return.

### Cons
- **Consistency Risk:** If the `mock` return and `real` return drift apart, frontend might break. (Can be solved by using a shared Schema).
- **Overhead:** Small amount of extra code for the `RouterFactory` logic.

---

## 5. Implementation Status
- [x] **`core/RouterFactory.js`**: Centralized route handler with auth & mock/real logic.
- [x] **`MOCK_MODE` Toggle**: Global control via `.env`.
- [x] **`scripts/generate-route.js`**: CLI for instant route scaffolding.
- [x] **Examples**: `userRoutes.js` and `transactionRoutes.js` implemented.

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

