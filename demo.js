#!/usr/bin/env node

/**
 * Demo script showing the Quick Fast Hybrid API system in action
 */

const http = require('http');

// Demo configuration
const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

console.log('🚀 Quick Fast Hybrid API Demo');
console.log('===============================');
console.log('');

// Test 1: Check server status
console.log('1. Server Status:');
makeRequest('/', (data) => {
  console.log(`   ✅ ${JSON.stringify(data, null, 2)}`);
  console.log('');

  // Test 2: Generate a new route
  console.log('2. Creating a new Product API:');
  const { execSync } = require('child_process');
  try {
    execSync('node scripts/generate-route.js Product', { stdio: 'pipe' });
    console.log('   ✅ Generated routes/productRoutes.js');
  } catch (error) {
    console.log('   ⚠️  Route generation may have failed, but continuing...');
  }
  console.log('');

  // Test 3: Check auto-discovery
  console.log('3. Auto-Discovery Status:');
  setTimeout(() => {
    makeRequest('/', (data) => {
      if (data.auto_discovery) {
        console.log('   ✅ Auto-discovery enabled');
      } else {
        console.log('   ❌ Auto-discovery disabled');
      }
      console.log('');

      // Test 4: Show route structure
      console.log('4. Route Structure Example:');
      console.log('   Example route definition:');
      console.log(`   {
     path: '/users/:id',
     method: 'GET',
     capability: 'users:read',
     schema: UserSchema, // Contract validation
     mock: (req) => MockDataService.user(req.params.id),
     real: async (req) => { /* database logic */ }
   }`);
      console.log('');

      console.log('🎉 Demo Complete!');
      console.log('');
      console.log('Key Features Implemented:');
      console.log('- ✅ RouterFactory with mock/real switching');
      console.log('- ✅ Auto-route discovery (zero-config registration)');
      console.log('- ✅ Smart MockDataService');
      console.log('- ✅ Contract validation with Zod schemas');
      console.log('- ✅ Traceability headers (X-Implementation-Mode)');
      console.log('- ✅ Global MOCK_MODE toggle');
      console.log('');
      console.log('Usage:');
      console.log('- Run: MOCK_MODE=true node server.js');
      console.log('- Create routes: node scripts/generate-route.js ModelName');
      console.log('- Switch to real: MOCK_MODE=false');
    });
  }, 1000);
});

function makeRequest(path, callback) {
  const options = {
    hostname: 'localhost',
    port: PORT,
    path: path,
    method: 'GET'
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      try {
        callback(JSON.parse(data));
      } catch (e) {
        callback(data);
      }
    });
  });

  req.on('error', (e) => {
    console.log(`   ❌ Server not running: ${e.message}`);
    console.log('   Run: MOCK_MODE=true node server.js');
    process.exit(1);
  });

  req.end();
}
