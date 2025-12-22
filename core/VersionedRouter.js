/**
 * Versioned API Router
 * Supports multiple API versions with backward compatibility
 */

const express = require('express');
const RouterFactory = require('./RouterFactory');
const logger = require('./Logger');

class VersionedRouter {
  constructor() {
    this.versions = new Map();
    this.currentVersion = 'v1';
  }

  /**
   * Register routes for a specific version
   * @param {string} version - Version string (e.g., 'v1', 'v2')
   * @param {Array} routes - Array of route definitions
   */
  registerVersion(version, routes) {
    if (!this.versions.has(version)) {
      this.versions.set(version, []);
    }

    this.versions.get(version).push(...routes);

    logger.info(`Registered routes for API version`, {
      version,
      routeCount: routes.length
    });
  }

  /**
   * Set the current/default version
   * @param {string} version
   */
  setCurrentVersion(version) {
    if (!this.versions.has(version)) {
      throw new Error(`Version ${version} not registered`);
    }
    this.currentVersion = version;
    logger.info(`Set current API version`, { version });
  }

  /**
   * Get routes for a specific version
   * @param {string} version
   * @returns {Array} Route definitions
   */
  getRoutes(version) {
    return this.versions.get(version) || [];
  }

  /**
   * Get all registered versions
   * @returns {Array} Array of version strings
   */
  getVersions() {
    return Array.from(this.versions.keys()).sort();
  }

  /**
   * Create Express router with versioned routes
   * @returns {express.Router}
   */
  createRouter() {
    const router = express.Router();

    // Version-specific routes
    this.versions.forEach((routes, version) => {
      router.use(`/api/${version}`, RouterFactory.create(routes));
    });

    // Default routes (current version)
    router.use('/api', RouterFactory.create(this.getRoutes(this.currentVersion)));

    // API info endpoint
    router.get('/api', (req, res) => {
      const versions = this.getVersions();
      res.json({
        message: 'API Server Running',
        versions,
        currentVersion: this.currentVersion,
        endpoints: {
          docs: '/api-docs',
          health: '/health',
          versioned: versions.map(v => `/api/${v}`),
          default: '/api'
        }
      });
    });

    // Version info endpoint
    router.get('/api/versions', (req, res) => {
      const versionInfo = {};

      this.versions.forEach((routes, version) => {
        versionInfo[version] = {
          routeCount: routes.length,
          routes: routes.map(r => ({
            path: r.path,
            method: r.method,
            capability: r.capability
          }))
        };
      });

      res.json({
        versions: this.getVersions(),
        currentVersion: this.currentVersion,
        versionDetails: versionInfo
      });
    });

    return router;
  }

  /**
   * Middleware to extract API version from request
   * Supports: Accept-Version header, query param, or URL path
   */
  static versionMiddleware() {
    return (req, res, next) => {
      // Extract version from various sources
      let version = req.headers['accept-version'] ||
                   req.query.version ||
                   this.extractVersionFromPath(req.path);

      if (version && !version.startsWith('v')) {
        version = `v${version}`;
      }

      // Set version on request for use in routes
      req.apiVersion = version || 'v1';

      // Add version header to response
      res.setHeader('X-API-Version', req.apiVersion);

      next();
    };
  }

  /**
   * Extract version from URL path
   * @param {string} path
   * @returns {string|null}
   */
  static extractVersionFromPath(path) {
    const versionMatch = path.match(/^\/api\/(v\d+)/);
    return versionMatch ? versionMatch[1] : null;
  }

  /**
   * Create version-specific route definition helper
   * @param {Object} routeDef - Base route definition
   * @param {Object} versionOverrides - Version-specific overrides
   * @returns {Object} Version-aware route definition
   */
  static createVersionedRoute(routeDef, versionOverrides = {}) {
    return {
      ...routeDef,
      // Allow version-specific implementations
      getImplementation: (req) => {
        const version = req.apiVersion;
        const override = versionOverrides[version];

        if (override) {
          return {
            mock: override.mock || routeDef.mock,
            real: override.real || routeDef.real,
            schema: override.schema || routeDef.schema
          };
        }

        return {
          mock: routeDef.mock,
          real: routeDef.real,
          schema: routeDef.schema
        };
      }
    };
  }
}

module.exports = VersionedRouter;
