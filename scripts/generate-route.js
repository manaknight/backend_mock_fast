const fs = require('fs');
const path = require('path');

const name = process.argv[2];
const projectId = process.argv[3]; // Optional: target project

if (!name) {
  console.log('Usage: node scripts/generate-route.js <ModelName> [projectId]');
  console.log('Example (Shared): node scripts/generate-route.js Product');
  console.log('Example (Project): node scripts/generate-route.js Product alpha');
  process.exit(1);
}

const lowerName = name.toLowerCase();
const pluralName = `${lowerName}s`;
const fileName = `${lowerName}Routes.js`;

let routesDir;
if (projectId) {
  routesDir = path.join(process.cwd(), 'projects', projectId, 'routes');
  if (!fs.existsSync(path.join(process.cwd(), 'projects', projectId))) {
    console.error(`Error: Project directory "projects/${projectId}" does not exist.`);
    process.exit(1);
  }
} else {
  routesDir = path.join(process.cwd(), 'routes');
}

const filePath = path.join(routesDir, fileName);

if (!fs.existsSync(routesDir)) {
  fs.mkdirSync(routesDir, { recursive: true });
}

const template = `const DatabaseService = require('${projectId ? '../../../' : '../'}services/DatabaseService');
const MockDataService = require('${projectId ? '../../../' : '../'}services/MockDataService');
const { z } = require('zod');

/**
 * Route definitions for ${name}
 */
module.exports = [
  {
    path: '/${pluralName}',
    method: 'GET',
    capability: '${pluralName}:read',
    mock: () => MockDataService.list(() => MockDataService.user(), 3),
    real: async (req, db) => {
      return await db.find('${pluralName}', {
        orderBy: { createdAt: 'desc' }
      });
    }
  },
  {
    path: '/${pluralName}/:id',
    method: 'GET',
    capability: '${pluralName}:read',
    mock: (req) => MockDataService.user(req.params.id),
    real: async (req, db) => {
      return await db.findOne('${pluralName}', {
        where: { id: req.params.id }
      });
    }
  }
];
`;

if (fs.existsSync(filePath)) {
  console.error(`Error: File ${filePath} already exists.`);
  process.exit(1);
}

fs.writeFileSync(filePath, template);

console.log(`
✅ Generated ${pluralName} routes at: ${projectId ? 'projects/' + projectId + '/' : ''}routes/${fileName}

Next Steps:
${projectId ? '1. The TenantManager will auto-discover these routes.' : '1. The Server auto-discovery will register these shared routes.'}
2. Toggle MOCK_MODE=true in .env to test the mock implementation.
`);

