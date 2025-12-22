const express = require('express');
const auth = require('../middleware/auth');
const { requireCapability } = require('../middleware/capability');
const { z } = require('zod');
const { catchAsync, ValidationError, NotFoundError, DatabaseError } = require('./errors');

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
        schema, // Zod schema for response validation
        requestSchema, // Zod schema for request validation { body, query, params }
        delay, // Optional delay override for this route
        forceMock = false,
        noAuth = false
      } = route;

      const middlewares = [];

      // 0. Request Validation Middleware
      if (requestSchema) {
        middlewares.push(catchAsync(async (req, res, next) => {
          if (requestSchema.body) requestSchema.body.parse(req.body);
          if (requestSchema.query) requestSchema.query.parse(req.query);
          if (requestSchema.params) requestSchema.params.parse(req.params);
          next();
        }));
      }

      // 1. Auth/Capability Middleware
      if (!noAuth) {
        if (capability) {
          middlewares.push(requireCapability(capability));
        } else {
          middlewares.push(auth.verifyToken);
        }
      }
      // Note: requireCapability automatically includes auth verification

      // 2. Main handler
      const handler = catchAsync(async (req, res) => {
        // Priority: route-level forceMock > global MOCK_MODE
        const shouldUseMock = forceMock || (isGlobalMock && !route.forceReal);

        // Add traceability header
        res.setHeader('X-Implementation-Mode', shouldUseMock ? 'MOCK' : 'REAL');

        // Latency simulation for mocks
        if (shouldUseMock) {
          const mockDelay = delay !== undefined ? delay : (parseInt(process.env.MOCK_LATENCY) || 0);
          if (mockDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, mockDelay));
          }
        }

        let responseData;

        if (shouldUseMock && mock) {
          responseData = typeof mock === 'function' ? await mock(req) : mock;
        } else if (real) {
          responseData = await real(req);
        } else {
          // Fallback if neither mock nor real is available/selected
          throw new NotFoundError(`No ${shouldUseMock ? 'mock' : 'real'} implementation for ${method} ${path}`);
        }

        // Validate response against schema if provided
        if (schema && schema instanceof z.ZodSchema) {
          try {
            schema.parse(responseData);
          } catch (validationError) {
            console.error(`Schema validation failed for ${method} ${path}:`, validationError.errors);
            throw new ValidationError(`Response does not match expected schema. Mode: ${shouldUseMock ? 'MOCK' : 'REAL'}`);
          }
        }

        return res.json({
          success: true,
          data: responseData,
          ...(shouldUseMock && { _mock: true })
        });
      });

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

