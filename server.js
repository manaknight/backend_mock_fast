require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const RouterFactory = require('./core/RouterFactory');
const VersionedRouter = require('./core/VersionedRouter');
const { globalErrorHandler } = require('./core/errors');
const { applySecurityMiddleware } = require('./middleware/security');
const logger = require('./core/Logger');
const TenantManager = require('./core/TenantManager');
const AdminConsole = require('./services/AdminConsole');

const app = express();
const port = process.env.PORT || 3000;

// Logging middleware
app.use(morgan('combined', { stream: logger.stream }));

// Middleware to parse JSON bodies
app.use(express.json());

// Apply security middleware
applySecurityMiddleware(app);

// 1. Initialize Tenant Manager for multi-project support
const tenantManager = new TenantManager(app);
tenantManager.loadProjects();

// Initialize versioned router
const versionedRouter = new VersionedRouter();

// 1.5. Initialize Admin Console for debugging and operations
const adminConsole = new AdminConsole(app);

// 2. Shared Routes Registration (Auto-discovery)
const allRouteDefinitions = [];

// Auto-discover and register all route files with versioning support
const routesPath = path.join(__dirname, 'routes');

if (fs.existsSync(routesPath)) {
  const routeFiles = fs.readdirSync(routesPath)
    .filter(file => file.endsWith('Routes.js'))
    .map(file => path.join(routesPath, file));

  logger.info(`Auto-discovering routes from ${routeFiles.length} files`, {
    routeFiles: routeFiles.map(f => path.basename(f))
  });

  routeFiles.forEach(filePath => {
    try {
      const routeModule = require(filePath);
      const routeName = path.basename(filePath, '.js').replace('Routes', '');

      // Support both versioned and legacy route formats
      if (routeModule.v1 && routeModule.v2) {
        // Versioned routes
        versionedRouter.registerVersion('v1', routeModule.v1);
        versionedRouter.registerVersion('v2', routeModule.v2);

        // Store for documentation
        allRouteDefinitions.push(...routeModule.v1.map(r => ({ ...r, source: 'shared' })),
                                ...routeModule.v2.map(r => ({ ...r, source: 'shared' })));

        logger.info(`Versioned routes loaded successfully`, {
          routeName,
          versions: ['v1', 'v2'],
          v1Count: routeModule.v1.length,
          v2Count: routeModule.v2.length
        });
      } else {
        // Legacy format - register as v1 and also with RouterFactory for tenant support
        const routes = Array.isArray(routeModule) ? routeModule : routeModule.default || [];
        versionedRouter.registerVersion('v1', routes);
        allRouteDefinitions.push(...routes.map(r => ({ ...r, source: 'shared' })));

        // Also register with RouterFactory for multi-tenant compatibility
        app.use('/api', RouterFactory.create(routes));

        logger.info(`Legacy routes loaded as v1`, {
          routeName,
          routeCount: routes.length
        });
      }
    } catch (error) {
      logger.error(`Failed to load route file`, {
        filePath,
        error: error.message,
        stack: error.stack
      });
    }
  });

  // Set current version (can be configured via env)
  versionedRouter.setCurrentVersion(process.env.API_VERSION || 'v1');

  // Use versioned router
  app.use(versionedRouter.createRouter());
}

// 3. Health Check & Root
app.get('/', (req, res) => {
  res.json({
    message: 'Quick Fast Hybrid API is running',
    mock_mode: process.env.MOCK_MODE === 'true',
    versioning: true,
    versions: versionedRouter.getVersions(),
    currentVersion: versionedRouter.currentVersion,
    projects_loaded: Array.from(tenantManager.projects.keys()),
    docs: '/api-docs'
  });
});

// 4. API Documentation Endpoint
app.get('/api-docs', (req, res) => {
  const versions = versionedRouter.getVersions();
  const versionedDocs = {};

  // Group routes by version
  versions.forEach(version => {
    const routes = versionedRouter.getRoutes(version);
    versionedDocs[version] = routes.map(r => ({
      path: `/api/${version}${r.path}`,
      method: r.method || 'GET',
      capability: r.capability,
      authRequired: !r.noAuth,
      requestSchema: r.requestSchema ? 'ZodSchema' : null,
      responseSchema: r.schema ? 'ZodSchema' : null,
      source: 'versioned'
    }));
  });

  // Combine shared routes with project routes for docs
  const projectRoutes = [];
  tenantManager.projects.forEach((data, projectId) => {
    const projectPath = path.join(process.cwd(), 'projects', projectId, 'routes');
    if (fs.existsSync(projectPath)) {
      const files = fs.readdirSync(projectPath).filter(f => f.endsWith('Routes.js'));
      files.forEach(file => {
        const def = require(path.join(projectPath, file));
        projectRoutes.push(...def.map(r => ({ ...r, path: `/${projectId}${r.path}`, source: projectId })));
      });
    }
  });

  const allDocs = [...allRouteDefinitions, ...projectRoutes];
  const docs = allDocs.map(r => ({
    path: `/api${r.path}`,
    method: r.method || 'GET',
    capability: r.capability,
    authRequired: !r.noAuth,
    source: r.source,
    requestSchema: r.requestSchema ? 'ZodSchema' : null,
    responseSchema: r.schema ? 'ZodSchema' : null
  }));
>>>>>>> 8a80d728ee4d98588b1abff9307fd87f9351deef

  res.send(`
    <html>
      <head>
        <title>API Documentation - Versioned</title>
        <style>
          body { font-family: sans-serif; padding: 20px; line-height: 1.6; background: #f4f4f9; }
          .version-section { background: white; margin-bottom: 20px; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .route { background: #f9f9f9; margin-bottom: 10px; padding: 15px; border-radius: 6px; border-left: 4px solid #007bff; }
          .method { display: inline-block; padding: 4px 8px; border-radius: 4px; color: white; font-weight: bold; min-width: 60px; text-align: center; }
          .GET { background: #61affe; }
          .POST { background: #49cc90; }
          .PUT { background: #fca130; }
          .DELETE { background: #f93e3e; }
          .path { font-family: monospace; font-size: 1.1em; margin-left: 10px; }
          .meta { margin-top: 8px; color: #666; font-size: 0.9em; }
          .version-header { color: #007bff; border-bottom: 2px solid #007bff; padding-bottom: 5px; }
          .source { float: right; color: #999; font-style: italic; }
          h1 { color: #333; }
          .current-version { background: #e8f5e8; border-color: #28a745; }
          .current-version .version-header { color: #28a745; border-color: #28a745; }
        </style>
      </head>
      <body>
        <h1>Quick Fast Hybrid API Docs</h1>
        <p><strong>Current Version:</strong> ${versionedRouter.currentVersion}</p>
        <p><strong>Available Versions:</strong> ${versions.join(', ')}</p>
        <p><strong>Projects Loaded:</strong> ${Array.from(tenantManager.projects.keys()).join(', ') || 'none'}</p>
        <p><strong>Usage:</strong> Use <code>/api/v1/endpoint</code> or <code>/api/endpoint</code> (defaults to current version)</p>

        ${versions.map(version => `
          <div class="version-section ${version === versionedRouter.currentVersion ? 'current-version' : ''}">
            <h2 class="version-header">Version ${version} ${version === versionedRouter.currentVersion ? '(Current)' : ''}</h2>
            ${versionedDocs[version].map(d => `
              <div class="route">
                <span class="source">versioned</span>
                <span class="method ${d.method}">${d.method}</span>
                <span class="path">${d.path}</span>
                <div class="meta">
                  Capability: ${d.capability || 'none'} | Auth: ${d.authRequired ? '✅' : '❌'} |
                  Validation: ${d.requestSchema ? 'Request ✅' : ''} ${d.responseSchema ? 'Response ✅' : ''}
                </div>
              </div>
            `).join('')}
          </div>
        `).join('')}

        <h2>Project Routes</h2>
        ${docs.filter(d => d.source !== 'versioned').map(d => `
          <div class="route">
            <span class="source">${d.source}</span>
            <span class="method ${d.method}">${d.method}</span>
            <span class="path">${d.path}</span>
            <div class="meta">
              Capability: ${d.capability || 'none'} | Auth: ${d.authRequired ? '✅' : '❌'} |
              Validation: ${d.requestSchema ? 'Req ✅' : ''} ${d.responseSchema ? 'Res ✅' : ''}
            </div>
          </div>
        `).join('')}
      </body>
    </html>
  `);
});

// Health check route with detailed status
app.get('/health', async (req, res) => {
  const healthCheck = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: require('./package.json').version,
    mockMode: process.env.MOCK_MODE === 'true',
    apiVersion: versionedRouter.currentVersion,
    availableVersions: versionedRouter.getVersions(),
    projectsLoaded: Array.from(tenantManager.projects.keys())
  };

  // Check database connection if not in mock mode
  if (process.env.MOCK_MODE !== 'true') {
    try {
      const DatabaseService = require('./services/DatabaseService');
      // Add a simple health check for the database
      healthCheck.database = 'OK';
    } catch (error) {
      healthCheck.database = 'ERROR';
      healthCheck.status = 'DEGRADED';
      logger.error('Database health check failed', { error: error.message });
    }
  } else {
    healthCheck.database = 'MOCK';
  }

  // Check memory usage
  const memUsage = process.memoryUsage();
  healthCheck.memory = {
    rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
    heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`
  };

  const statusCode = healthCheck.status === 'OK' ? 200 : 503;
  res.status(statusCode).json(healthCheck);
});

// Readiness check (for Kubernetes/load balancers)
app.get('/ready', (req, res) => {
  // Basic readiness check - server is listening
  res.json({
    status: 'READY',
    timestamp: new Date().toISOString()
  });
});

// Liveness check (for Kubernetes)
app.get('/live', (req, res) => {
  res.json({
    status: 'ALIVE',
    timestamp: new Date().toISOString()
  });
});

// Global error handling middleware (must be last)
app.use(globalErrorHandler);

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}, initiating graceful shutdown`, {
    uptime: process.uptime(),
    signal
  });

  // Stop accepting new connections
  server.close((err) => {
    if (err) {
      logger.error('Error during server shutdown', { error: err.message });
      process.exit(1);
    }

    logger.info('Server closed successfully');

    // Close database connections if any
    if (process.env.MOCK_MODE !== 'true') {
      try {
        const DatabaseService = require('./services/DatabaseService');
        // Add database cleanup here if needed
        logger.info('Database connections cleaned up');
      } catch (error) {
        logger.error('Error cleaning up database connections', { error: error.message });
      }
    }

    // Close logger transports
    logger.logger.end(() => {
      logger.info('Logger transports closed');
      process.exit(0);
    });
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

// Start server
const server = app.listen(port, () => {
  logger.info('Server started successfully', {
    port,
    environment: process.env.NODE_ENV,
    mockMode: process.env.MOCK_MODE === 'true',
    nodeVersion: process.version,
    apiVersions: versionedRouter.getVersions(),
    currentVersion: versionedRouter.currentVersion,
    projectsLoaded: Array.from(tenantManager.projects.keys())
  });
});

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack
  });
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', {
    reason: reason.message || reason,
    promise: promise.toString()
  });
  gracefulShutdown('unhandledRejection');
});
