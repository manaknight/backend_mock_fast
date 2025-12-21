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
    mock: () => MockDataService.list(() => MockDataService.user(), 3),
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
    mock: (req) => MockDataService.user(req.params.id),
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
    schema: UserSchema, // Validate that created user matches structure
    mock: (req) => ({
      ...MockDataService.user(),
      ...req.body, // Merge with provided data
      createdAt: new Date().toISOString()
    }),
    real: async (req) => {
      // Logic for creating a user
      return await DatabaseService.create('users', req.body);
    }
  }
];
