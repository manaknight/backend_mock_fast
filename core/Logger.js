/**
 * Structured Logging Service using Winston
 * Provides consistent logging across the application with multiple transports
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

winston.addColors(colors);

// Create the base logger configuration
const createLogger = () => {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const isTest = process.env.NODE_ENV === 'test';

  // Skip logging in tests unless explicitly enabled
  if (isTest && !process.env.ENABLE_TEST_LOGGING) {
    return {
      error: () => {},
      warn: () => {},
      info: () => {},
      http: () => {},
      debug: () => {},
      log: () => {},
      stream: { write: () => {} }
    };
  }

  // Custom format for console output
  const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.colorize({ all: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      let metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
      return `${timestamp} [${level}]: ${message}${metaStr}`;
    })
  );

  // Custom format for file output (no colors, more structured)
  const fileFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  );

  // Transports configuration
  const transports = [];

  // Console transport for development
  if (isDevelopment) {
    transports.push(
      new winston.transports.Console({
        level: process.env.LOG_LEVEL || 'debug',
        format: consoleFormat,
        handleExceptions: true,
        handleRejections: true,
      })
    );
  }

  // File transports for production/structured logging
  if (!isTest) {
    const logDir = path.join(process.cwd(), 'logs');

    // Error log file
    transports.push(
      new DailyRotateFile({
        filename: path.join(logDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        format: fileFormat,
        maxSize: '20m',
        maxFiles: '14d',
      })
    );

    // Combined log file
    transports.push(
      new DailyRotateFile({
        filename: path.join(logDir, 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        format: fileFormat,
        maxSize: '20m',
        maxFiles: '14d',
      })
    );

    // HTTP request log file
    transports.push(
      new DailyRotateFile({
        filename: path.join(logDir, 'http-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'http',
        format: fileFormat,
        maxSize: '20m',
        maxFiles: '14d',
      })
    );
  }

  const logger = winston.createLogger({
    level: isDevelopment ? 'debug' : 'info',
    levels,
    transports,
    exitOnError: false,
  });

  // Add Morgan stream for HTTP request logging
  logger.stream = {
    write: (message) => {
      logger.http(message.trim());
    },
  };

  return logger;
};

// Create and export the logger instance
const logger = createLogger();

// Enhanced logging methods with context
const enhancedLogger = {
  error: (message, meta = {}) => logger.error(message, { ...meta, timestamp: new Date().toISOString() }),
  warn: (message, meta = {}) => logger.warn(message, { ...meta, timestamp: new Date().toISOString() }),
  info: (message, meta = {}) => logger.info(message, { ...meta, timestamp: new Date().toISOString() }),
  http: (message, meta = {}) => logger.http(message, { ...meta, timestamp: new Date().toISOString() }),
  debug: (message, meta = {}) => logger.debug(message, { ...meta, timestamp: new Date().toISOString() }),

  // Specialized logging methods
  logRequest: (req, res, responseTime) => {
    logger.http('HTTP Request', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      userId: req.user?.id || 'anonymous'
    });
  },

  logError: (error, req = null) => {
    logger.error('Application Error', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      url: req?.url,
      method: req?.method,
      userId: req?.user?.id,
      ip: req?.ip
    });
  },

  logDatabase: (operation, collection, query = {}, duration = null, error = null) => {
    const level = error ? 'error' : 'debug';
    logger.log(level, 'Database Operation', {
      operation,
      collection,
      query: JSON.stringify(query),
      duration: duration ? `${duration}ms` : null,
      error: error?.message
    });
  },

  logAuth: (action, userId, success = true, details = {}) => {
    logger.info('Authentication Event', {
      action,
      userId,
      success,
      ...details
    });
  },

  logApiCall: (endpoint, method, userId, success = true, duration = null) => {
    logger.http('API Call', {
      endpoint,
      method,
      userId,
      success,
      duration: duration ? `${duration}ms` : null
    });
  },

  // Stream for Morgan HTTP logging
  stream: logger.stream
};

module.exports = enhancedLogger;
