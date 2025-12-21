require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const RouterFactory = require('./core/RouterFactory');
const TenantManager = require('./core/TenantManager');
const AdminConsole = require('./services/AdminConsole');

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// 1. Initialize Tenant Manager for multi-project support
const tenantManager = new TenantManager(app);
tenantManager.loadProjects();

// 1.5. Initialize Admin Console for debugging and operations
const adminConsole = new AdminConsole(app);

// 2. Shared Routes Registration (Auto-discovery)
const allRouteDefinitions = [];
const routesPath = path.join(__dirname, 'routes');

if (fs.existsSync(routesPath)) {
  const routeFiles = fs.readdirSync(routesPath)
    .filter(file => file.endsWith('Routes.js'))
    .map(file => path.join(routesPath, file));

  console.log(`🔍 Auto-discovering shared routes from ${routeFiles.length} files:`);

  routeFiles.forEach(filePath => {
    try {
      const routeDef = require(filePath);
      allRouteDefinitions.push(...routeDef.map(r => ({ ...r, source: 'shared' })));
      const routeName = path.basename(filePath, '.js');
      app.use('/api', RouterFactory.create(routeDef));
      console.log(`  ✅ ${routeName}`);
    } catch (error) {
      console.error(`  ❌ Failed to load ${filePath}:`, error.message);
    }
  });
}

// 3. Health Check & Root
app.get('/', (req, res) => {
  res.json({
    message: 'Quick Fast Hybrid API is running',
    mock_mode: process.env.MOCK_MODE === 'true',
    projects_loaded: Array.from(tenantManager.projects.keys()),
    docs: '/api-docs'
  });
});

// 4. API Documentation Endpoint
app.get('/api-docs', (req, res) => {
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

  const docs = [...allRouteDefinitions, ...projectRoutes].map(r => ({
    path: `/api${r.path}`,
    method: r.method || 'GET',
    capability: r.capability,
    authRequired: !r.noAuth,
    source: r.source,
    requestSchema: r.requestSchema ? 'ZodSchema' : null,
    responseSchema: r.schema ? 'ZodSchema' : null
  }));

  res.send(`
    <html>
      <head>
        <title>API Documentation</title>
        <style>
          body { font-family: sans-serif; padding: 20px; line-height: 1.6; background: #f4f4f9; }
          .route { background: white; margin-bottom: 10px; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .method { display: inline-block; padding: 4px 8px; border-radius: 4px; color: white; font-weight: bold; min-width: 60px; text-align: center; }
          .GET { background: #61affe; }
          .POST { background: #49cc90; }
          .PUT { background: #fca130; }
          .DELETE { background: #f93e3e; }
          .path { font-family: monospace; font-size: 1.1em; margin-left: 10px; }
          .meta { margin-top: 8px; color: #666; font-size: 0.9em; }
          .source { float: right; color: #999; font-style: italic; }
          h1 { color: #333; }
        </style>
      </head>
      <body>
        <h1>Quick Fast Hybrid API Docs</h1>
        ${docs.map(d => `
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

// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  console.log(`Mock Mode: ${process.env.MOCK_MODE === 'true' ? 'ON 🛠️' : 'OFF 🚀'}`);
});
