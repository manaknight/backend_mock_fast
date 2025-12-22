// Test setup file
require('dotenv').config({ path: '.env.test' });

// Set test environment
process.env.NODE_ENV = 'test';
process.env.MOCK_MODE = 'true';
process.env.JWT_SECRET = 'test_jwt_secret';

// Mock console methods to reduce noise during tests
global.originalConsole = { ...console };
console.log = jest.fn();
console.info = jest.fn();
console.warn = jest.fn();
console.error = jest.fn();

// Restore console after all tests
afterAll(() => {
  global.console = global.originalConsole;
});
