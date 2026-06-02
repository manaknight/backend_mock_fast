const DatabaseService = require('../services/DatabaseService');

/**
 * Route definitions for Product
 */
module.exports = [
  {
    path: '/products',
    method: 'GET',
    capability: 'products:read',
    mock: () => [
      { id: 1, name: 'Mock Product 1', createdAt: new Date().toISOString() },
      { id: 2, name: 'Mock Product 2', createdAt: new Date().toISOString() }
    ],
    real: async (req) => {
      return await DatabaseService.find('products', {
        orderBy: { createdAt: 'desc' }
      });
    }
  },
  {
    path: '/products/:id',
    method: 'GET',
    capability: 'products:read',
    mock: (req) => ({
      id: req.params.id,
      name: 'Mock Product ' + req.params.id,
      description: 'This is a detailed mock description for Product',
      createdAt: new Date().toISOString()
    }),
    real: async (req) => {
      const results = await DatabaseService.find('products', {
        where: { id: req.params.id }
      });
      return results[0];
    }
  },
  {
    path: '/products',
    method: 'POST',
    capability: 'products:write',
    mock: (req) => ({
      id: Math.floor(Math.random() * 1000),
      ...req.body,
      createdAt: new Date().toISOString()
    }),
    real: async (req) => {
      // Logic for creating a Product
      // return await DatabaseService.create('products', req.body);
      return { message: 'Product creation logic goes here', received: req.body };
    }
  }
];
