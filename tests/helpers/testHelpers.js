/**
 * Test Helper Functions
 */

// Create a test app with specific routes
const createTestApp = (routes) => {
  const express = require('express');
  const RouterFactory = require('../../core/RouterFactory');
  const { globalErrorHandler } = require('../../core/errors');

  const app = express();
  app.use(express.json());

  if (routes) {
    app.use('/api', RouterFactory.create(routes));
  }

  app.use(globalErrorHandler);
  return app;
};

// Generate test JWT token
const generateTestToken = (payload = { userId: 'test-user', role: 'member' }) => {
  const jwt = require('jsonwebtoken');
  return jwt.sign(payload, 'test_jwt_secret');
};

// Test database helpers
const resetTestDb = async () => {
  // Reset mock data service
  const MockDataService = require('../../services/MockDataService');
  MockDataService.storage = {
    users: [],
    products: [],
    transactions: []
  };
};

// Mock external services
const mockStripeService = () => {
  jest.mock('../../services/StripeService', () => ({
    createPaymentIntent: jest.fn().mockResolvedValue({ id: 'pi_test', client_secret: 'secret' }),
    confirmPayment: jest.fn().mockResolvedValue({ status: 'succeeded' })
  }));
};

const mockEmailService = () => {
  jest.mock('../../services/EmailService', () => ({
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendPasswordReset: jest.fn().mockResolvedValue(true)
  }));
};

module.exports = {
  createTestApp,
  generateTestToken,
  resetTestDb,
  mockStripeService,
  mockEmailService
};
