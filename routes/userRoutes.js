// Conditionally import DatabaseService only when not in mock mode
let DatabaseService;
if (process.env.MOCK_MODE !== 'true') {
  DatabaseService = require('../services/DatabaseService');
}
const MockDataService = require('../services/MockDataService');
const { z } = require('zod');
const VersionedRouter = require('../core/VersionedRouter');

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
 * Demonstrates API versioning with backward compatibility
 */

// Version-specific schemas
const UserSchemaV1 = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.string(),
  avatar: z.string().url().optional(),
  createdAt: z.string().datetime()
});

const UserSchemaV2 = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.string(),
  avatar: z.string().url().optional(),
  createdAt: z.string().datetime(),
  // New fields in v2
  lastLoginAt: z.string().datetime().optional(),
  preferences: z.object({
    theme: z.enum(['light', 'dark']).optional(),
    notifications: z.boolean().optional()
  }).optional()
});

// Versioned route definitions
const userRoutesV1 = [
  {
    path: '/users',
    method: 'GET',
    capability: 'users:read',
    schema: z.array(UserSchemaV1),
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
    schema: UserSchemaV1,
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
    schema: UserSchemaV1,
    mock: (req) => {
      const newUser = {
        ...MockDataService.user(),
        ...req.body,
        createdAt: new Date().toISOString()
      };
      return MockDataService.persist('users', newUser);
    },
    real: async (req) => {
      return await DatabaseService.create('users', req.body);
    }
  }
];

const userRoutesV2 = [
  {
    path: '/users',
    method: 'GET',
    capability: 'users:read',
    schema: z.array(UserSchemaV2),
    mock: () => {
      const users = MockDataService.findAll('users');
      if (users.length === 0) {
        // Seed with v2 enhanced data
        const seeded = MockDataService.list(() => ({
          ...MockDataService.user(),
          lastLoginAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
          preferences: {
            theme: Math.random() > 0.5 ? 'dark' : 'light',
            notifications: Math.random() > 0.3
          }
        }), 3);
        seeded.forEach(u => MockDataService.persist('users', u));
        return seeded;
      }
      // Enhance existing users with v2 fields
      return users.map(user => ({
        ...user,
        lastLoginAt: user.lastLoginAt || new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
        preferences: user.preferences || {
          theme: Math.random() > 0.5 ? 'dark' : 'light',
          notifications: Math.random() > 0.3
        }
      }));
    },
    real: async (req) => {
      // V2 implementation would include the new fields from database
      return await DatabaseService.find('users', {
        orderBy: { createdAt: 'desc' }
      });
    }
  },
  {
    path: '/users/:id',
    method: 'GET',
    capability: 'users:read',
    schema: UserSchemaV2,
    mock: (req) => {
      const user = MockDataService.findById('users', req.params.id);
      if (user) {
        // Enhance with v2 fields
        return {
          ...user,
          lastLoginAt: user.lastLoginAt || new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
          preferences: user.preferences || {
            theme: Math.random() > 0.5 ? 'dark' : 'light',
            notifications: Math.random() > 0.3
          }
        };
      }
      return MockDataService.user(req.params.id);
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
        email: z.string().email(),
        preferences: z.object({
          theme: z.enum(['light', 'dark']).optional(),
          notifications: z.boolean().optional()
        }).optional()
      })
    },
    schema: UserSchemaV2,
    mock: (req) => {
      const newUser = {
        ...MockDataService.user(),
        ...req.body,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      };
      return MockDataService.persist('users', newUser);
    },
    real: async (req) => {
      return await DatabaseService.create('users', req.body);
    }
  }
];

// Export versioned routes
module.exports = {
  v1: userRoutesV1,
  v2: userRoutesV2,
  // Default export for backward compatibility
  default: userRoutesV1
};
