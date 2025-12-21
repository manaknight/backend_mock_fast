const express = require('express');
const auth = require('../middleware/auth');
const { requireCapability } = require('../middleware/capability');
const { z } = require('zod');
const DatabaseService = require('../services/DatabaseService');
const TenantDatabaseService = require('./TenantDatabaseService');
const AutoCRUDRouter = require('../services/AutoCRUDRouter');
const SchemaIntelligenceService = require('../services/SchemaIntelligenceService');

/**
 * RouterFactory generates Express routers from a structured route definition.
 */
class RouterFactory {
  /**
   * Creates an Express router from an array of route definitions.
   * @param {Array} routes - Array of route objects
   * @param {Object} options - Factory options { projectId, tenantDb }
   * @returns {express.Router}
   */
  static create(routes, options = {}) {
    const { projectId } = options;
    let { tenantDb } = options;

    const router = express.Router();
    const isGlobalMock = process.env.MOCK_MODE === 'true';

    // Create tenant-aware database service if projectId is provided and tenantDb isn't
    if (projectId && !tenantDb) {
      tenantDb = new TenantDatabaseService(DatabaseService, projectId);
    }

    routes.forEach(route => {
      // Check if this is an auto-CRUD route (has resource and schema, minimal other config)
      if (this.isAutoCRUDRoute(route)) {
        const crudRouter = AutoCRUDRouter.create(route, options);
        router.use(route.path || `/${route.resource}`, crudRouter);
        return; // Skip normal route processing
      }
      const {
        path,
        method = 'GET',
        capability,
        mock,
        real,
        schema, // Zod schema for response validation
        requestSchema, // Zod schema for request validation
        delay, // Optional delay override
        forceMock = false,
        noAuth = false
      } = route;

      const middlewares = [];

      // 0. Request Validation Middleware
      if (requestSchema) {
        middlewares.push((req, res, next) => {
          try {
            if (requestSchema.body) requestSchema.body.parse(req.body);
            if (requestSchema.query) requestSchema.query.parse(req.query);
            if (requestSchema.params) requestSchema.params.parse(req.params);
            next();
          } catch (error) {
            return res.status(400).json({
              success: false,
              error: 'Request Validation Failed',
              details: error.errors
            });
          }
        });
      }

      // 1. Auth/Capability Middleware
      if (!noAuth) {
        if (capability) {
          middlewares.push(requireCapability(capability));
        } else {
          middlewares.push(auth.verifyToken);
        }
      }

      // 2. Main handler
      const handler = async (req, res) => {
        try {
          const shouldUseMock = forceMock || (isGlobalMock && !route.forceReal);
          res.setHeader('X-Implementation-Mode', shouldUseMock ? 'MOCK' : 'REAL');

          if (shouldUseMock) {
            const mockDelay = delay !== undefined ? delay : (parseInt(process.env.MOCK_LATENCY) || 0);
            if (mockDelay > 0) await new Promise(resolve => setTimeout(resolve, mockDelay));
          }

          let responseData;

          if (shouldUseMock && mock) {
            responseData = typeof mock === 'function' ? await mock(req) : mock;
          } else if (real) {
            // Inject tenantDb if available, otherwise fallback to base DatabaseService
            responseData = await real(req, tenantDb || DatabaseService);
          } else {
            return res.status(501).json({
              error: 'Not Implemented',
              message: `No ${shouldUseMock ? 'mock' : 'real'} implementation for ${method} ${path}`
            });
          }

          if (schema && schema instanceof z.ZodSchema) {
            try {
              schema.parse(responseData);
            } catch (validationError) {
              console.error(`Schema validation failed for ${method} ${path}:`, validationError.errors);
              return res.status(500).json({
                success: false,
                error: 'Contract Violation',
                message: `Response does not match expected schema.`,
                details: validationError.errors
              });
            }
          }

          return res.json({ success: true, data: responseData, ...(shouldUseMock && { _mock: true }) });
        } catch (error) {
          console.error(`Error in ${method} ${path}:`, error);
          res.status(error.status || 500).json({
            success: false,
            error: error.name || 'Internal Server Error',
            message: error.message
          });
        }
      };

      const expressMethod = method.toLowerCase();
      if (typeof router[expressMethod] === 'function') {
        router[expressMethod](path, ...middlewares, handler);
      }
    });

    return router;
  }

  /**
   * Check if a route definition should use AutoCRUDRouter
   * @param {Object} route - Route definition
   * @returns {boolean}
   */
  static isAutoCRUDRoute(route) {
    // Must have resource name and schema
    if (!route.resource || !route.schema) {
      return false;
    }

    // Must have capabilities object (even if empty)
    if (!route.capabilities) {
      return false;
    }

    // Should not have traditional route properties
    const hasTraditionalProps = route.method || route.path || route.mock || route.real || route.handler;
    if (hasTraditionalProps) {
      return false;
    }

    return true;
  }
}

module.exports = RouterFactory;
