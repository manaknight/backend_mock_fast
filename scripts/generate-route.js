const fs = require('fs');
const path = require('path');

const name = process.argv[2];
if (!name) {
  console.log('Usage: node scripts/generate-route.js <ModelName>');
  console.log('Example: node scripts/generate-route.js Product');
  process.exit(1);
}

const lowerName = name.toLowerCase();
const pluralName = `${lowerName}s`;
const fileName = `${lowerName}Routes.js`;
const routesDir = path.join(process.cwd(), 'routes');
const filePath = path.join(routesDir, fileName);

if (!fs.existsSync(routesDir)) {
  fs.mkdirSync(routesDir);
}

const template = `const DatabaseService = require('../services/DatabaseService');

/**
 * Route definitions for ${name}
 */
module.exports = [
  {
    path: '/${pluralName}',
    method: 'GET',
    capability: '${pluralName}:read',
    mock: () => [
      { id: 1, name: 'Mock ${name} 1', createdAt: new Date().toISOString() },
      { id: 2, name: 'Mock ${name} 2', createdAt: new Date().toISOString() }
    ],
    real: async (req) => {
      return await DatabaseService.find('${pluralName}', {
        orderBy: { createdAt: 'desc' }
      });
    }
  },
  {
    path: '/${pluralName}/:id',
    method: 'GET',
    capability: '${pluralName}:read',
    mock: (req) => ({
      id: req.params.id,
      name: 'Mock ${name} ' + req.params.id,
      description: 'This is a detailed mock description for ${name}',
      createdAt: new Date().toISOString()
    }),
    real: async (req) => {
      const results = await DatabaseService.find('${pluralName}', {
        where: { id: req.params.id }
      });
      return results[0];
    }
  },
  {
    path: '/${pluralName}',
    method: 'POST',
    capability: '${pluralName}:write',
    mock: (req) => ({
      id: Math.floor(Math.random() * 1000),
      ...req.body,
      createdAt: new Date().toISOString()
    }),
    real: async (req) => {
      // Logic for creating a ${name}
      // return await DatabaseService.create('${pluralName}', req.body);
      return { message: '${name} creation logic goes here', received: req.body };
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
✅ Generated ${pluralName} routes at: routes/${fileName}

Next Steps:
1. Register these routes in server.js:
   const RouterFactory = require('./core/RouterFactory');
   const ${lowerName}Routes = require('./routes/${fileName}');
   app.use('/api', RouterFactory.create(${lowerName}Routes));

2. Toggle MOCK_MODE=true in .env to test the mock implementation.
`);

