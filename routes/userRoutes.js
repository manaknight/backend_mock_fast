// Conditionally import DatabaseService only when not in mock mode
let DatabaseService;
if (process.env.MOCK_MODE !== 'true') {
  DatabaseService = require('../services/DatabaseService');
}
const MockDataService = require('../services/MockDataService');
const { z } = require('zod');

// Define contract schemas for validation
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.string(),
  avatar: z.string().url().optional(),
  createdAt: z.string().datetime()
});

const UserListSchema = z.array(UserSchema);

/**
 * Route definitions for User with contract validation
 */
module.exports = [
  {
    path: '/users',
    method: 'GET',
    capability: 'users:read',
    schema: UserListSchema, // Validate that response is an array of users
    mock: () => {
      const stored = MockDataService.findAll('users');
      if (stored.length === 0) {
        // Seed with some data if empty
        const seeded = MockDataService.list(() => MockDataService.user(), 3);
        seeded.forEach(u => MockDataService.persist('users', u));
        return seeded;
      }
      return stored;
    },
    real: async (req) => {
      return await DatabaseService.find('users', {
        orderBy: { createdAt: 'desc' }
      });
    }
  },
  {
    path: '/users/:id',
    method: 'GET',
    capability: 'users:read',
    schema: UserSchema, // Validate that response matches user structure
    mock: (req) => {
      const user = MockDataService.findById('users', req.params.id);
      return user || MockDataService.user(req.params.id);
    },
    real: async (req) => {
      const results = await DatabaseService.find('users', {
        where: { id: req.params.id }
      });
      return results[0];
    }
  },
  {
    path: '/users',
    method: 'POST',
    capability: 'users:write',
    requestSchema: {
      body: z.object({
        name: z.string().min(2),
        email: z.string().email()
      })
    },
    schema: UserSchema, // Validate that created user matches structure
    mock: (req) => {
      const newUser = {
        ...MockDataService.user(),
        ...req.body, // Merge with provided data
        createdAt: new Date().toISOString()
      };
      return MockDataService.persist('users', newUser);
    },
    real: async (req) => {
      // Logic for creating a user
      return await DatabaseService.create('users', req.body);
    }
  }
];
