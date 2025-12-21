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
    auto_discovery: true
  });
});

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
      const routeName = path.basename(filePath, '.js');
      app.use('/api', RouterFactory.create(routeDef));
      console.log(`  ✅ ${routeName}`);
    } catch (error) {
      console.error(`  ❌ Failed to load ${filePath}:`, error.message);
    }
  });
} else {
  console.log('⚠️  No routes directory found. Create some routes with: node scripts/generate-route.js <ModelName>');
}

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  console.log(`Mock Mode: ${process.env.MOCK_MODE === 'true' ? 'ON 🛠️' : 'OFF 🚀'}`);
});
