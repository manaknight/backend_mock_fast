const DatabaseService = require('../services/DatabaseService');

/**
 * Route definitions for User
 */
module.exports = [
  {
    path: '/users',
    method: 'GET',
    capability: 'users:read',
    mock: () => [
      { id: 1, name: 'Mock User 1', createdAt: new Date().toISOString() },
      { id: 2, name: 'Mock User 2', createdAt: new Date().toISOString() }
    ],
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
    mock: (req) => ({
      id: req.params.id,
      name: 'Mock User ' + req.params.id,
      description: 'This is a detailed mock description for User',
      createdAt: new Date().toISOString()
    }),
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
    mock: (req) => ({
      id: Math.floor(Math.random() * 1000),
      ...req.body,
      createdAt: new Date().toISOString()
    }),
    real: async (req) => {
      // Logic for creating a User
      // return await DatabaseService.create('users', req.body);
      return { message: 'User creation logic goes here', received: req.body };
    }
  }
];
