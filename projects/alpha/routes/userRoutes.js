const MockDataService = require('../../../services/MockDataService');

/**
 * Project-specific routes for Alpha
 */
module.exports = [
  {
    path: '/users',
    method: 'GET',
    mock: (req) => MockDataService.list(() => MockDataService.user(), 2),
    real: async (req, db) => {
      // 'db' is namespaced to 'alpha' automatically
      // This will query 'alpha_users' table
      return await db.find('users');
    }
  },
  {
    path: '/status',
    method: 'GET',
    noAuth: true,
    mock: () => ({ status: 'Project Alpha is healthy', timestamp: new Date() }),
    real: async () => ({ status: 'Real implementation active', timestamp: new Date() })
  }
];
