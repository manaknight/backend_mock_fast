const express = require('express');
const auth = require('../middleware/auth');
const { requireCapability } = require('../middleware/capability');

/**
 * RouterFactory generates Express routers from a structured route definition.
 * It automatically handles:
 * 1. Mock vs Real implementation switching
 * 2. Auth and Capability middleware injection
 * 3. Standardized response formatting
 * 4. Error handling
 */
class RouterFactory {
  /**
   * Creates an Express router from an array of route definitions.
   * @param {Array} routes - Array of route objects
   * @returns {express.Router}
   */
  static create(routes) {
    const router = express.Router();
    const isGlobalMock = process.env.MOCK_MODE === 'true';

    routes.forEach(route => {
      const {
        path,
        method = 'GET',
        capability,
        mock,
        real,
        forceMock = false,
        noAuth = false
      } = route;

      const middlewares = [];

      // 1. Auth/Capability Middleware
      if (!noAuth) {
        middlewares.push(auth.verifyToken);
        if (capability) {
          middlewares.push(requireCapability(capability));
        }
      }

      // 2. Main handler
      const handler = async (req, res) => {
        try {
          // Priority: route-level forceMock > global MOCK_MODE
          const shouldUseMock = forceMock || (isGlobalMock && !route.forceReal);

          if (shouldUseMock && mock) {
            const mockData = typeof mock === 'function' ? await mock(req) : mock;
            return res.json({
              success: true,
              data: mockData,
              _mock: true
            });
          }

          if (real) {
            const data = await real(req);
            return res.json({
              success: true,
              data: data
            });
          }

          // Fallback if neither mock nor real is available/selected
          res.status(501).json({
            error: 'Not Implemented',
            message: `No ${shouldUseMock ? 'mock' : 'real'} implementation for ${method} ${path}`
          });
        } catch (error) {
          console.error(`Error in ${method} ${path}:`, error);
          res.status(error.status || 500).json({
            success: false,
            error: error.name || 'Internal Server Error',
            message: error.message
          });
        }
      };

      // Register route with Express
      const expressMethod = method.toLowerCase();
      if (typeof router[expressMethod] === 'function') {
        router[expressMethod](path, ...middlewares, handler);
      } else {
        console.error(`Unsupported HTTP method: ${method} for path ${path}`);
      }
    });

    return router;
  }
}

module.exports = RouterFactory;

