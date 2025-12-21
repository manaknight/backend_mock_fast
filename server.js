require('dotenv').config();
const express = require('express');
const RouterFactory = require('./core/RouterFactory');
const userRoutes = require('./routes/userRoutes');
const transactionRoutes = require('./routes/transactionRoutes');

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Quick Fast Hybrid API is running',
    mock_mode: process.env.MOCK_MODE === 'true'
  });
});

// Use RouterFactory to create and register routes
// Prefix with /api for all structured routes
app.use('/api', RouterFactory.create(userRoutes));
app.use('/api', RouterFactory.create(transactionRoutes));

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  console.log(`Mock Mode: ${process.env.MOCK_MODE === 'true' ? 'ON 🛠️' : 'OFF 🚀'}`);
});
