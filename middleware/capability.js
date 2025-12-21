const DatabaseService = require('../services/DatabaseService');
const { hasCapability } = require('../core/Capability');

// Middleware to check if user has required capability
const requireCapability = (requiredCapability) => {
  return async (req, res, next) => {
    try {
      // Get user role from database
      const users = await DatabaseService.find('users', {
        where: { id: req.user.id },
        select: ['role', 'status', 'is_premium']
      });

      if (users.length === 0) {
        return res.status(404).json({
          error: 'User not found',
          message: 'User account does not exist'
        });
      }

      const user = users[0];

      if (user.status !== 'active') {
        return res.status(403).json({
          error: 'Account suspended',
          message: 'Your account has been suspended'
        });
      }

      // Check if user has the required capability
      if (!hasCapability(user.role.toLowerCase(), requiredCapability)) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: `This action requires the '${requiredCapability}' capability`
        });
      }

      // Store user info for later use
      req.user.role = user.role;
      req.user.status = user.status;
      req.user.is_premium = user.is_premium;

      next();
    } catch (error) {
      return res.status(500).json({
        error: 'Authorization error',
        message: error.message
      });
    }
  };
};

// Middleware to check if user has any of the required capabilities
const requireAnyCapability = (...requiredCapabilities) => {
  return async (req, res, next) => {
    try {
      // Get user role from database
      const users = await DatabaseService.find('users', {
        where: { id: req.user.id },
        select: ['role', 'status', 'is_premium']
      });

      if (users.length === 0) {
        return res.status(404).json({
          error: 'User not found',
          message: 'User account does not exist'
        });
      }

      const user = users[0];

      if (user.status !== 'active') {
        return res.status(403).json({
          error: 'Account suspended',
          message: 'Your account has been suspended'
        });
      }

      // Check if user has any of the required capabilities
      const hasAnyCapability = requiredCapabilities.some(capability =>
        hasCapability(user.role.toLowerCase(), capability)
      );

      if (!hasAnyCapability) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: `This action requires one of the following capabilities: ${requiredCapabilities.join(', ')}`
        });
      }

      // Store user info for later use
      req.user.role = user.role;
      req.user.status = user.status;
      req.user.is_premium = user.is_premium;

      next();
    } catch (error) {
      return res.status(500).json({
        error: 'Authorization error',
        message: error.message
      });
    }
  };
};

module.exports = {
  requireCapability,
  requireAnyCapability,
};
