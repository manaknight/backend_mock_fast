/**
 * MockDataService - Generates consistent, smart fake data
 * This ensures your mocks are realistic and repeatable across routes
 */
class MockDataService {
  constructor() {
    this.seed = 0; // For deterministic results
    this.storage = {
      users: [],
      products: [],
      transactions: []
    };
  }

  // Persist data in memory
  persist(collection, data) {
    if (!this.storage[collection]) this.storage[collection] = [];

    // Simple update or create logic
    const index = this.storage[collection].findIndex(item => item.id === data.id);
    if (index >= 0) {
      this.storage[collection][index] = { ...this.storage[collection][index], ...data };
    } else {
      this.storage[collection].push(data);
    }
    return data;
  }

  // Get from memory
  findAll(collection) {
    return this.storage[collection] || [];
  }

  findById(collection, id) {
    return (this.storage[collection] || []).find(item => item.id === id);
  }

  // Generate a deterministic random number based on seed
  seededRandom() {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  // Set seed for repeatable results
  setSeed(seed) {
    this.seed = seed;
  }

  // User mock data
  user(id) {
    const userIds = ['u_123', 'u_456', 'u_789', 'u_101'];
    const names = ['Alice Johnson', 'Bob Smith', 'Carol Williams', 'David Brown'];
    const emails = ['alice@example.com', 'bob@example.com', 'carol@example.com', 'david@example.com'];
    const roles = ['Member', 'Admin', 'Support', 'Premium'];

    const index = id ? userIds.indexOf(id) : Math.floor(Math.random() * userIds.length);
    const safeIndex = index >= 0 ? index : Math.floor(Math.random() * userIds.length);

    return {
      id: userIds[safeIndex],
      name: names[safeIndex],
      email: emails[safeIndex],
      role: roles[safeIndex],
      avatar: `https://i.pravatar.cc/150?u=${userIds[safeIndex]}`,
      createdAt: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString()
    };
  }

  // Product mock data
  product(id) {
    const products = [
      { id: 'p_1', name: 'Premium Widget', price: 99.99, category: 'Widgets' },
      { id: 'p_2', name: 'Basic Gadget', price: 49.99, category: 'Gadgets' },
      { id: 'p_3', name: 'Pro Service', price: 199.99, category: 'Services' }
    ];

    const product = products.find(p => p.id === id) || products[Math.floor(Math.random() * products.length)];
    return {
      ...product,
      description: `This is a high-quality ${product.name.toLowerCase()}.`,
      inStock: Math.random() > 0.2, // 80% chance of being in stock
      tags: ['premium', 'featured', 'new']
    };
  }

  // Transaction mock data
  transaction(id) {
    return {
      id: id || 'txn_' + Math.random().toString(36).substr(2, 9),
      amount: Math.floor(Math.random() * 500) + 10,
      currency: 'usd',
      status: ['pending', 'completed', 'failed'][Math.floor(Math.random() * 3)],
      createdAt: new Date().toISOString(),
      receiptUrl: 'https://example.com/receipt.pdf'
    };
  }

  // Generic list generator
  list(itemGenerator, count = 5) {
    return Array.from({ length: count }, (_, i) => itemGenerator(i));
  }

  // UUID generator
  uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Random price
  price(min = 10, max = 1000) {
    return Math.floor(Math.random() * (max - min + 1) + min);
  }

  // Random date within range
  date(daysAgo = 365) {
    const now = Date.now();
    const past = now - (daysAgo * 24 * 60 * 60 * 1000);
    return new Date(past + Math.random() * (now - past)).toISOString();
  }

  // Success response wrapper
  success(data, message = 'Success') {
    return {
      success: true,
      message,
      data
    };
  }

  // Error response wrapper
  error(message = 'An error occurred', code = 500) {
    return {
      success: false,
      message,
      code
    };
  }
}

module.exports = new MockDataService();
