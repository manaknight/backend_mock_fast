const jwt = require('jsonwebtoken');

// Conditionally import DatabaseService only when not in mock mode
let DatabaseService;
if (process.env.MOCK_MODE !== 'true') {
  DatabaseService = require('../services/DatabaseService');
}

// Verify JWT token
const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        error: 'Access denied',
        message: 'No token provided'
      });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).json({
          error: 'Invalid token',
          message: 'Token is not valid'
        });
      }

      req.user = decoded;
      next();
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Authentication error',
      message: error.message
    });
  }
};

// Check user roles
const requireRole = (...allowedRoles) => {
  return [verifyToken, async (req, res, next) => {
    try {
      // In mock mode, skip database checks and use mock user data
      if (process.env.MOCK_MODE === 'true') {
        req.user.role = req.user.role || 'Member';
        req.user.is_premium = req.user.is_premium || false;
        return next();
      }

      const users = await DatabaseService.find('users', {
        where: { id: req.user.id },
        select: ['role', 'is_premium', 'status', 'tenant_id']
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

      if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: `This action requires ${allowedRoles.join(' or ')} role`
        });
      }

      req.user.role = user.role;
      req.user.status = user.status;
      req.user.tenantId = user.tenant_id;
      req.user.is_premium = user.is_premium;
      next();
    } catch (error) {
      return res.status(500).json({
        error: 'Authorization error',
        message: error.message
      });
    }
  }];
};

// Check if user is premium (for premium-only features)
const requirePremium = (req, res, next) => {
  // Admin and Support bypass premium check
  if (req.user.role === 'Admin' || req.user.role === 'Support') {
    return next();
  }

  if (!req.user.is_premium) {
    return res.status(403).json({
      error: 'Premium required',
      message: 'This feature requires a premium subscription'
    });
  }
  next();
};

// Combined middleware for different access levels
const auth = {
  verifyToken,
  requireRole,
  requirePremium,
  // Common role combinations
  requireMember: requireRole('Member', 'Admin', 'Support'),
  requireAdmin: requireRole('Admin'), // Tenant-scoped admin
  requireSuperAdmin: requireRole('SuperAdmin'), // Global system admin
  requireAdminOrSupport: requireRole('Admin', 'Support'),
  requireAnyAdmin: requireRole('Admin', 'SuperAdmin'), // Any type of admin
  requirePremiumMember: [requireRole('Member', 'Admin', 'Support'), requirePremium]
};

module.exports = auth;
