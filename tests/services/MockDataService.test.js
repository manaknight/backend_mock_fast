const MockDataService = require('../../services/MockDataService');

describe('MockDataService', () => {
  beforeEach(() => {
    // Reset the mock storage before each test
    MockDataService.storage = {
      users: [],
      products: [],
      transactions: []
    };
  });

  describe('persist', () => {
    test('should persist new data', () => {
      const testData = { id: 'test-1', name: 'Test Item' };

      const result = MockDataService.persist('users', testData);

      expect(result).toEqual(testData);
      expect(MockDataService.storage.users).toContain(testData);
    });

    test('should update existing data', () => {
      const initialData = { id: 'test-1', name: 'Initial' };
      const updatedData = { id: 'test-1', name: 'Updated' };

      MockDataService.persist('users', initialData);
      const result = MockDataService.persist('users', updatedData);

      expect(result).toEqual(updatedData);
      expect(MockDataService.storage.users).toHaveLength(1);
      expect(MockDataService.storage.users[0]).toEqual(updatedData);
    });
  });

  describe('findAll', () => {
    test('should return all items in collection', () => {
      const testData = [
        { id: '1', name: 'Item 1' },
        { id: '2', name: 'Item 2' }
      ];

      testData.forEach(item => MockDataService.persist('products', item));
      const result = MockDataService.findAll('products');

      expect(result).toEqual(testData);
    });

    test('should return empty array for non-existent collection', () => {
      const result = MockDataService.findAll('nonexistent');
      expect(result).toEqual([]);
    });
  });

  describe('findById', () => {
    test('should find item by id', () => {
      const testData = { id: 'test-1', name: 'Test Item' };
      MockDataService.persist('users', testData);

      const result = MockDataService.findById('users', 'test-1');
      expect(result).toEqual(testData);
    });

    test('should return undefined for non-existent id', () => {
      const result = MockDataService.findById('users', 'nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('user', () => {
    test('should generate a user object', () => {
      const user = MockDataService.user();

      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('name');
      expect(user).toHaveProperty('email');
      expect(user).toHaveProperty('role');
      expect(user).toHaveProperty('avatar');
      expect(user).toHaveProperty('createdAt');
    });

    test('should return specific user by id', () => {
      const user = MockDataService.user('u_123');

      expect(user.id).toBe('u_123');
      expect(user.name).toBe('Alice Johnson');
      expect(user.email).toBe('alice@example.com');
    });
  });

  describe('product', () => {
    test('should generate a product object', () => {
      const product = MockDataService.product();

      expect(product).toHaveProperty('id');
      expect(product).toHaveProperty('name');
      expect(product).toHaveProperty('price');
      expect(product).toHaveProperty('category');
      expect(product).toHaveProperty('description');
      expect(product).toHaveProperty('inStock');
    });
  });

  describe('uuid', () => {
    test('should generate a valid UUID format', () => {
      const uuid = MockDataService.uuid();

      // UUID v4 regex pattern
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuid).toMatch(uuidRegex);
    });
  });

  describe('list', () => {
    test('should generate a list of items', () => {
      const users = MockDataService.list(() => ({ name: 'User' }), 3);

      expect(users).toHaveLength(3);
      expect(users.every(user => user.name === 'User')).toBe(true);
    });
  });

  describe('success/error wrappers', () => {
    test('success should wrap data correctly', () => {
      const data = { id: 1, name: 'Test' };
      const result = MockDataService.success(data, 'Custom message');

      expect(result).toEqual({
        success: true,
        message: 'Custom message',
        data
      });
    });

    test('error should wrap error correctly', () => {
      const result = MockDataService.error('Test error', 400);

      expect(result).toEqual({
        success: false,
        message: 'Test error',
        code: 400
      });
    });
  });
});
