require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const RouterFactory = require('./core/RouterFactory');

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Quick Fast Hybrid API is running',
    mock_mode: process.env.MOCK_MODE === 'true',
    auto_discovery: true,
    docs: '/api-docs'
  });
});

// Documentation store
const allRouteDefinitions = [];

// Auto-discover and register all route files
const routesPath = path.join(__dirname, 'routes');
if (fs.existsSync(routesPath)) {
  const routeFiles = fs.readdirSync(routesPath)
    .filter(file => file.endsWith('Routes.js'))
    .map(file => path.join(routesPath, file));

  console.log(`🔍 Auto-discovering routes from ${routeFiles.length} files:`);

  routeFiles.forEach(filePath => {
    try {
      const routeDef = require(filePath);
      allRouteDefinitions.push(...routeDef);
      const routeName = path.basename(filePath, '.js');
      app.use('/api', RouterFactory.create(routeDef));
      console.log(`  ✅ ${routeName}`);
    } catch (error) {
      console.error(`  ❌ Failed to load ${filePath}:`, error.message);
    }
  });
}

// API Documentation Endpoint
app.get('/api-docs', (req, res) => {
  const docs = allRouteDefinitions.map(r => ({
    path: `/api${r.path}`,
    method: r.method || 'GET',
    capability: r.capability,
    authRequired: !r.noAuth,
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
          h1 { color: #333; }
        </style>
      </head>
      <body>
        <h1>Quick Fast Hybrid API Docs</h1>
        ${docs.map(d => `
          <div class="route">
            <span class="method ${d.method}">${d.method}</span>
            <span class="path">${d.path}</span>
            <div class="meta">
              Capability: ${d.capability || 'none'} | Auth: ${d.authRequired ? '✅' : '❌'} |
              Validation: ${d.requestSchema ? 'Request ✅' : ''} ${d.responseSchema ? 'Response ✅' : ''}
            </div>
          </div>
        `).join('')}
      </body>
    </html>
  `);
});

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  console.log(`Mock Mode: ${process.env.MOCK_MODE === 'true' ? 'ON 🛠️' : 'OFF 🚀'}`);
});
