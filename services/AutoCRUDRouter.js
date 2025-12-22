const express = require('express');
const SchemaIntelligenceService = require('./SchemaIntelligenceService');
const MockDataService = require('./MockDataService');
const DatabaseService = require('./DatabaseService');
const QueryDSL = require('./QueryDSL');

/**
 * AutoCRUDRouter - Generates complete CRUD endpoints from minimal route definitions
 *
 * Input: { resource: 'orders', schema: OrderSchema, capabilities: {...} }
 * Output: GET /orders, POST /orders, GET /orders/:id, PATCH /orders/:id, DELETE /orders/:id
 */
class AutoCRUDRouter {
  constructor() {
    this.routers = new Map();
  }

  /**
   * Create a complete CRUD router from a minimal route definition
   * @param {Object} routeDef - Route definition
   * @param {Object} options - Factory options { projectId, tenantDb }
   */
  create(routeDef, options = {}) {
    const { projectId, tenantDb } = options;

    // Register schema with intelligence service
    if (routeDef.schema) {
      SchemaIntelligenceService.registerSchema(routeDef.resource, routeDef.schema, {
        tenantId: projectId,
        hooks: routeDef.hooks
      });
    }

    const router = express.Router();
    const resource = routeDef.resource;
    const basePath = routeDef.path || `/${resource}`;

    // LIST - GET /resource
    if (routeDef.capabilities?.list) {
      router.get(basePath, this.createListHandler(routeDef, options));
    }

    // CREATE - POST /resource
    if (routeDef.capabilities?.create) {
      router.post(basePath, this.createCreateHandler(routeDef, options));
    }

    // GET ONE - GET /resource/:id
    if (routeDef.capabilities?.read) {
      router.get(`${basePath}/:id`, this.createReadHandler(routeDef, options));
    }

    // UPDATE - PATCH /resource/:id
    if (routeDef.capabilities?.update) {
      router.patch(`${basePath}/:id`, this.createUpdateHandler(routeDef, options));
    }

    // DELETE - DELETE /resource/:id
    if (routeDef.capabilities?.delete) {
      router.delete(`${basePath}/:id`, this.createDeleteHandler(routeDef, options));
    }

    this.routers.set(resource, router);
    return router;
  }

  /**
   * Create LIST handler - GET /resource
   */
  createListHandler(routeDef, options) {
    const { projectId, tenantDb } = options;
    const isGlobalMock = process.env.MOCK_MODE === 'true';

    return async (req, res) => {
      try {
        const shouldUseMock = routeDef.forceMock || (isGlobalMock && !routeDef.forceReal);
        const resource = routeDef.resource;

        if (shouldUseMock) {
          // Use mock data
          const mockDelay = parseInt(process.env.MOCK_LATENCY) || 0;
          if (mockDelay > 0) await new Promise(resolve => setTimeout(resolve, mockDelay));

          const stored = MockDataService.findAll(resource);
          if (stored.length === 0) {
            // Generate mock data
            const generators = SchemaIntelligenceService.getGeneratedSchema(resource)?.generated?.mocks;
            if (generators && generators[`${resource.slice(0, -1)}List`]) {
              const seeded = generators[`${resource.slice(0, -1)}List`](5);
              seeded.forEach(item => MockDataService.persist(resource, item));
              return res.json({ success: true, data: seeded, _mock: true });
            }
          }

          // Parse query parameters for filtering
          const filtered = this.applyQueryFilters(stored, req.query);
          return res.json({ success: true, data: filtered, _mock: true });

        } else {
          // Use real database with QueryDSL
          const query = QueryDSL.parse(req.query);
          const db = tenantDb || DatabaseService;

          // Execute lifecycle hook
          await SchemaIntelligenceService.executeHook(resource, 'beforeList', query, { req });

          const results = await db.find(resource, query);

          // Execute lifecycle hook
          const processedResults = await SchemaIntelligenceService.executeHook(
            resource, 'afterList', results, { req, query }
          );

          return res.json({ success: true, data: processedResults || results });
        }
      } catch (error) {
        console.error('AutoCRUD LIST error:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    };
  }

  /**
   * Create CREATE handler - POST /resource
   */
  createCreateHandler(routeDef, options) {
    const { projectId, tenantDb } = options;
    const isGlobalMock = process.env.MOCK_MODE === 'true';

    return async (req, res) => {
      try {
        const shouldUseMock = routeDef.forceMock || (isGlobalMock && !routeDef.forceReal);
        const resource = routeDef.resource;

        // Execute lifecycle hook
        await SchemaIntelligenceService.executeHook(resource, 'beforeCreate', req.body, { req });

        if (shouldUseMock) {
          // Use mock data
          const mockDelay = parseInt(process.env.MOCK_LATENCY) || 0;
          if (mockDelay > 0) await new Promise(resolve => setTimeout(resolve, mockDelay));

          const generators = SchemaIntelligenceService.getGeneratedSchema(resource)?.generated?.mocks;
          if (generators && generators[resource.slice(0, -1)]) {
            const newItem = {
              ...generators[resource.slice(0, -1)](),
              ...req.body,
              id: req.body.id || SchemaIntelligenceService.generateUUID(),
              createdAt: new Date().toISOString()
            };

            const saved = MockDataService.persist(resource, newItem);

            // Execute lifecycle hook
            await SchemaIntelligenceService.executeHook(resource, 'afterCreate', saved, { req });

            return res.status(201).json({ success: true, data: saved, _mock: true });
          }
        } else {
          // Use real database
          const db = tenantDb || DatabaseService;
          const dataToInsert = {
            ...req.body,
            id: req.body.id || SchemaIntelligenceService.generateUUID(),
            createdAt: new Date().toISOString()
          };

          const result = await db.insert(resource, dataToInsert);

          // Execute lifecycle hook
          await SchemaIntelligenceService.executeHook(resource, 'afterCreate', result, { req });

          return res.status(201).json({ success: true, data: result });
        }
      } catch (error) {
        console.error('AutoCRUD CREATE error:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    };
  }

  /**
   * Create READ handler - GET /resource/:id
   */
  createReadHandler(routeDef, options) {
    const { projectId, tenantDb } = options;
    const isGlobalMock = process.env.MOCK_MODE === 'true';

    return async (req, res) => {
      try {
        const shouldUseMock = routeDef.forceMock || (isGlobalMock && !routeDef.forceReal);
        const resource = routeDef.resource;
        const id = req.params.id;

        // Execute lifecycle hook
        await SchemaIntelligenceService.executeHook(resource, 'beforeRead', { id }, { req });

        if (shouldUseMock) {
          const mockDelay = parseInt(process.env.MOCK_LATENCY) || 0;
          if (mockDelay > 0) await new Promise(resolve => setTimeout(resolve, mockDelay));

          const item = MockDataService.findById(resource, id);
          if (!item) {
            return res.status(404).json({ success: false, error: 'Not found' });
          }

          // Execute lifecycle hook
          await SchemaIntelligenceService.executeHook(resource, 'afterRead', item, { req });

          return res.json({ success: true, data: item, _mock: true });
        } else {
          const db = tenantDb || DatabaseService;
          const result = await db.findOne(resource, { where: { id } });

          if (!result) {
            return res.status(404).json({ success: false, error: 'Not found' });
          }

          // Execute lifecycle hook
          await SchemaIntelligenceService.executeHook(resource, 'afterRead', result, { req });

          return res.json({ success: true, data: result });
        }
      } catch (error) {
        console.error('AutoCRUD READ error:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    };
  }

  /**
   * Create UPDATE handler - PATCH /resource/:id
   */
  createUpdateHandler(routeDef, options) {
    const { projectId, tenantDb } = options;
    const isGlobalMock = process.env.MOCK_MODE === 'true';

    return async (req, res) => {
      try {
        const shouldUseMock = routeDef.forceMock || (isGlobalMock && !routeDef.forceReal);
        const resource = routeDef.resource;
        const id = req.params.id;

        // Execute lifecycle hook
        await SchemaIntelligenceService.executeHook(resource, 'beforeUpdate', { id, data: req.body }, { req });

        if (shouldUseMock) {
          const mockDelay = parseInt(process.env.MOCK_LATENCY) || 0;
          if (mockDelay > 0) await new Promise(resolve => setTimeout(resolve, mockDelay));

          const existing = MockDataService.findById(resource, id);
          if (!existing) {
            return res.status(404).json({ success: false, error: 'Not found' });
          }

          const updated = {
            ...existing,
            ...req.body,
            updatedAt: new Date().toISOString()
          };

          const saved = MockDataService.persist(resource, updated);

          // Execute lifecycle hook
          await SchemaIntelligenceService.executeHook(resource, 'afterUpdate', saved, { req });

          return res.json({ success: true, data: saved, _mock: true });
        } else {
          const db = tenantDb || DatabaseService;
          const result = await db.update(resource, req.body, { id });

          if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Not found' });
          }

          // Fetch updated record
          const updated = await db.findOne(resource, { where: { id } });

          // Execute lifecycle hook
          await SchemaIntelligenceService.executeHook(resource, 'afterUpdate', updated, { req });

          return res.json({ success: true, data: updated });
        }
      } catch (error) {
        console.error('AutoCRUD UPDATE error:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    };
  }

  /**
   * Create DELETE handler - DELETE /resource/:id
   */
  createDeleteHandler(routeDef, options) {
    const { projectId, tenantDb } = options;
    const isGlobalMock = process.env.MOCK_MODE === 'true';

    return async (req, res) => {
      try {
        const shouldUseMock = routeDef.forceMock || (isGlobalMock && !routeDef.forceReal);
        const resource = routeDef.resource;
        const id = req.params.id;

        // Execute lifecycle hook
        await SchemaIntelligenceService.executeHook(resource, 'beforeDelete', { id }, { req });

        if (shouldUseMock) {
          const mockDelay = parseInt(process.env.MOCK_LATENCY) || 0;
          if (mockDelay > 0) await new Promise(resolve => setTimeout(resolve, mockDelay));

          const existing = MockDataService.findById(resource, id);
          if (!existing) {
            return res.status(404).json({ success: false, error: 'Not found' });
          }

          MockDataService.delete(resource, id);

          // Execute lifecycle hook
          await SchemaIntelligenceService.executeHook(resource, 'afterDelete', { id }, { req });

          return res.json({ success: true, data: { id }, _mock: true });
        } else {
          const db = tenantDb || DatabaseService;
          const result = await db.delete(resource, { id });

          if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Not found' });
          }

          // Execute lifecycle hook
          await SchemaIntelligenceService.executeHook(resource, 'afterDelete', { id }, { req });

          return res.json({ success: true, data: { id } });
        }
      } catch (error) {
        console.error('AutoCRUD DELETE error:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    };
  }

  /**
   * Apply query filters for mock data
   */
  applyQueryFilters(data, query) {
    let filtered = [...data];

    // Apply filters
    Object.entries(query).forEach(([key, value]) => {
      if (key === 'limit' || key === 'offset' || key === 'sort') return;

      if (value.includes('>')) {
        const [field, threshold] = value.split('>');
        filtered = filtered.filter(item => item[field] > parseFloat(threshold));
      } else if (value.includes('<')) {
        const [field, threshold] = value.split('<');
        filtered = filtered.filter(item => item[field] < parseFloat(threshold));
      } else {
        filtered = filtered.filter(item => item[key] == value);
      }
    });

    // Apply sorting
    if (query.sort) {
      const [field, direction] = query.sort.startsWith('-')
        ? [query.sort.slice(1), 'desc']
        : [query.sort, 'asc'];

      filtered.sort((a, b) => {
        if (direction === 'desc') {
          return a[field] > b[field] ? -1 : 1;
        }
        return a[field] < b[field] ? -1 : 1;
      });
    }

    // Apply pagination
    const limit = parseInt(query.limit) || filtered.length;
    const offset = parseInt(query.offset) || 0;

    return filtered.slice(offset, offset + limit);
  }

  /**
   * Get generated router for a resource
   */
  getRouter(resource) {
    return this.routers.get(resource);
  }

  /**
   * Get all generated routers
   */
  getAllRouters() {
    return Array.from(this.routers.entries());
  }
}

module.exports = new AutoCRUDRouter();
