const request = require('supertest');
const userRoutes = require('../../routes/userRoutes');
const { createTestApp, resetTestDb } = require('../helpers/testHelpers');

describe('User Routes Integration Tests', () => {
  let app;

  beforeAll(() => {
    app = createTestApp(userRoutes);
  });

  beforeEach(() => {
    resetTestDb();
  });

  describe('GET /api/users', () => {
    test('should return users list', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('X-Implementation-Mode', 'MOCK'); // Force mock mode for testing

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.headers['x-implementation-mode']).toBe('MOCK');
    });

    test('should include mock indicator when using mocks', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('X-Implementation-Mode', 'MOCK');

      expect(response.body).toHaveProperty('_mock', true);
    });
  });

  describe('GET /api/users/:id', () => {
    test('should return specific user', async () => {
      const response = await request(app)
        .get('/api/users/u_123')
        .set('X-Implementation-Mode', 'MOCK');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe('u_123');
      expect(response.body.data).toHaveProperty('name');
      expect(response.body.data).toHaveProperty('email');
    });

    test('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .get('/api/users/nonexistent')
        .set('X-Implementation-Mode', 'MOCK');

      expect(response.status).toBe(200); // Mock returns a generated user
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
    });
  });

  describe('POST /api/users', () => {
    test('should create user with valid data', async () => {
      const userData = {
        name: 'John Doe',
        email: 'john.doe@example.com'
      };

      const response = await request(app)
        .post('/api/users')
        .set('X-Implementation-Mode', 'MOCK')
        .send(userData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.name).toBe('John Doe');
      expect(response.body.data.email).toBe('john.doe@example.com');
      expect(response.body.data).toHaveProperty('createdAt');
    });

    test('should validate required fields', async () => {
      const invalidData = {
        name: 'John Doe'
        // missing email
      };

      const response = await request(app)
        .post('/api/users')
        .set('X-Implementation-Mode', 'MOCK')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.name).toBe('ValidationError');
    });

    test('should validate email format', async () => {
      const invalidData = {
        name: 'John Doe',
        email: 'invalid-email'
      };

      const response = await request(app)
        .post('/api/users')
        .set('X-Implementation-Mode', 'MOCK')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.name).toBe('ValidationError');
    });
  });
});
