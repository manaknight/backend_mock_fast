const fs = require('fs');
const path = require('path');
const { z } = require('zod');

/**
 * verify-project.js - A safety check script to validate project code
 * before it's integrated into the main backend.
 */

const projectId = process.argv[2];

if (!projectId) {
  console.error('Usage: node scripts/verify-project.js <projectId>');
  process.exit(1);
}

const projectPath = path.join(process.cwd(), 'projects', projectId);

if (!fs.existsSync(projectPath)) {
  console.error(`Error: Project directory "${projectPath}" not found.`);
  process.exit(1);
}

console.log(`🛡️  Verifying project: ${projectId}`);

// 1. Check for required files
const requiredFiles = ['config.json', 'routes/'];
requiredFiles.forEach(file => {
  if (!fs.existsSync(path.join(projectPath, file))) {
    console.warn(`  ⚠️  Missing recommended file/dir: ${file}`);
  }
});

// 2. Validate Routes
const routesPath = path.join(projectPath, 'routes');
if (fs.existsSync(routesPath)) {
  const routeFiles = fs.readdirSync(routesPath).filter(f => f.endsWith('Routes.js'));

  if (routeFiles.length === 0) {
    console.warn('  ⚠️  No route files found in routes/');
  }

  for (const file of routeFiles) {
    const filePath = path.join(routesPath, file);
    try {
      const routes = require(filePath);

      if (!Array.isArray(routes)) {
        throw new Error(`${file} must export an array of route definitions.`);
      }

      routes.forEach((route, index) => {
        if (!route.path || !route.method) {
          throw new Error(`Route at index ${index} in ${file} is missing path or method.`);
        }

        if (typeof route.mock !== 'function' && typeof route.mock !== 'object' && route.mock !== undefined) {
          throw new Error(`Route ${route.method} ${route.path} has invalid 'mock' property.`);
        }

        if (route.real && typeof route.real !== 'function') {
          throw new Error(`Route ${route.method} ${route.path} has invalid 'real' property.`);
        }
      });

      console.log(`  ✅ ${file}: Validated ${routes.length} routes.`);
    } catch (error) {
      console.error(`  ❌ Validation failed for ${file}:`, error.message);
      process.exit(1);
    }
  }
}

console.log(`\n🎉 Project "${projectId}" passed all checks!`);
