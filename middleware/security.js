/**
 * Security Middleware
 * Provides rate limiting, security headers, and other security enhancements
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const logger = require('../core/Logger');

/**
 * Rate limiting configurations
 */

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      url: req.url,
      userAgent: req.get('User-Agent')
    });
    res.status(429).json({
      success: false,
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

// Stricter limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 auth attempts per windowMs
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later.',
    retryAfter: '15 minutes'
  },
  skipSuccessfulRequests: true, // Don't count successful requests
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded', {
      ip: req.ip,
      url: req.url,
      userAgent: req.get('User-Agent')
    });
    res.status(429).json({
      success: false,
      error: 'Too many authentication attempts, please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

// Create account limiter (even stricter)
const createAccountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // limit each IP to 3 account creations per hour
  message: {
    success: false,
    error: 'Too many account creation attempts, please try again later.',
    retryAfter: '1 hour'
  },
  handler: (req, res) => {
    logger.warn('Account creation rate limit exceeded', {
      ip: req.ip,
      url: req.url,
      userAgent: req.get('User-Agent')
    });
    res.status(429).json({
      success: false,
      error: 'Too many account creation attempts, please try again later.',
      retryAfter: '1 hour'
    });
  }
});

/**
 * Security headers middleware using Helmet
 */
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
});

/**
 * Custom security headers
 */
const customSecurityHeaders = (req, res, next) => {
  // Remove server header
  res.removeHeader('X-Powered-By');

  // Add custom security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Add request ID for tracing
  const requestId = req.headers['x-request-id'] || generateRequestId();
  res.setHeader('X-Request-ID', requestId);
  req.requestId = requestId;

  next();
};

/**
 * Request sanitization middleware
 */
const sanitizeInput = (req, res, next) => {
  // Basic input sanitization
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str.replace(/[<>]/g, '').trim();
  };

  // Sanitize query parameters
  if (req.query) {
    Object.keys(req.query).forEach(key => {
      if (typeof req.query[key] === 'string') {
        req.query[key] = sanitizeString(req.query[key]);
      }
    });
  }

  // Sanitize body parameters (basic - in production use a proper sanitizer)
  if (req.body && typeof req.body === 'object') {
    const sanitizeObject = (obj) => {
      const sanitized = {};
      Object.keys(obj).forEach(key => {
        if (typeof obj[key] === 'string') {
          sanitized[key] = sanitizeString(obj[key]);
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          sanitized[key] = sanitizeObject(obj[key]);
        } else {
          sanitized[key] = obj[key];
        }
      });
      return sanitized;
    };
    req.body = sanitizeObject(req.body);
  }

  next();
};

/**
 * CORS configuration (if needed)
 */
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const allowedOrigins = process.env.ALLOWED_ORIGINS ?
      process.env.ALLOWED_ORIGINS.split(',') :
      ['http://localhost:3000', 'http://localhost:3001'];

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      logger.warn('CORS origin not allowed', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
};

/**
 * Generate unique request ID
 */
function generateRequestId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Security monitoring middleware
 */
const securityMonitor = (req, res, next) => {
  const startTime = Date.now();

  // Log security-relevant requests
  if (req.path.includes('/auth') || req.path.includes('/admin')) {
    logger.info('Security-monitored request', {
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      requestId: req.requestId
    });
  }

  // Monitor response
  res.on('finish', () => {
    const duration = Date.now() - startTime;

    // Log slow requests
    if (duration > 5000) {
      logger.warn('Slow request detected', {
        method: req.method,
        path: req.path,
        duration,
        statusCode: res.statusCode,
        requestId: req.requestId
      });
    }

    // Log failed auth attempts
    if (res.statusCode === 401 && req.path.includes('/auth')) {
      logger.warn('Failed authentication attempt', {
        ip: req.ip,
        path: req.path,
        userAgent: req.get('User-Agent'),
        requestId: req.requestId
      });
    }
  });

  next();
};

/**
 * Apply security middleware based on route type
 */
const applySecurityMiddleware = (app) => {
  // Global security headers
  app.use(securityHeaders);
  app.use(customSecurityHeaders);

  // Global rate limiting
  app.use('/api/', apiLimiter);

  // Stricter rate limiting for auth routes
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', createAccountLimiter);

  // Input sanitization
  app.use('/api/', sanitizeInput);

  // Security monitoring
  app.use(securityMonitor);

  logger.info('Security middleware applied', {
    rateLimits: {
      api: '100 requests per 15 minutes',
      auth: '5 attempts per 15 minutes',
      registration: '3 attempts per hour'
    }
  });
};

module.exports = {
  apiLimiter,
  authLimiter,
  createAccountLimiter,
  securityHeaders,
  customSecurityHeaders,
  sanitizeInput,
  corsOptions,
  securityMonitor,
  applySecurityMiddleware
};
