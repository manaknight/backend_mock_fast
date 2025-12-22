/**
 * Custom Error Classes for consistent error handling
 */

class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';

    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401);
    this.name = 'AuthenticationError';
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403);
    this.name = 'AuthorizationError';
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
    this.name = 'NotFoundError';
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409);
    this.name = 'ConflictError';
  }
}

class DatabaseError extends AppError {
  constructor(message = 'Database operation failed') {
    super(message, 500);
    this.name = 'DatabaseError';
  }
}

class ExternalServiceError extends AppError {
  constructor(service, message = 'External service error') {
    super(`${service}: ${message}`, 502);
    this.name = 'ExternalServiceError';
    this.service = service;
  }
}

/**
 * Error response formatter
 */
const formatErrorResponse = (error, includeStack = false) => {
  const response = {
    success: false,
    error: {
      name: error.name || 'Error',
      message: error.message,
      statusCode: error.statusCode || 500,
      ...(process.env.NODE_ENV === 'development' && includeStack && {
        stack: error.stack
      })
    }
  };

  // Add additional context for specific error types
  if (error instanceof ValidationError && error.errors) {
    response.error.details = error.errors;
  }

  if (error instanceof ExternalServiceError) {
    response.error.service = error.service;
  }

  return response;
};

const logger = require('./Logger');

/**
 * Global error handler middleware
 */
const globalErrorHandler = (error, req, res, next) => {
  // Log error using structured logger
  logger.logError(error, req);

  // Handle known operational errors
  if (error instanceof AppError) {
    return res.status(error.statusCode).json(formatErrorResponse(error));
  }

  // Handle Zod validation errors
  if (error.name === 'ZodError') {
    const validationError = new ValidationError('Validation failed');
    validationError.errors = error.errors;
    return res.status(400).json(formatErrorResponse(validationError));
  }

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json(formatErrorResponse(new AuthenticationError('Invalid token')));
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json(formatErrorResponse(new AuthenticationError('Token expired')));
  }

  // Handle database errors
  if (error.code && error.code.startsWith('ER_')) {
    return res.status(500).json(formatErrorResponse(new DatabaseError('Database operation failed')));
  }

  // Default to 500 for unknown errors
  const internalError = new AppError('Something went wrong', 500);
  return res.status(500).json(formatErrorResponse(internalError, true));
};

/**
 * Async error wrapper for route handlers
 */
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

/**
 * Safe execution wrapper that converts thrown errors to AppErrors
 */
const safeExecute = async (operation, errorMessage = 'Operation failed') => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(errorMessage, 500);
  }
};

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  DatabaseError,
  ExternalServiceError,
  formatErrorResponse,
  globalErrorHandler,
  catchAsync,
  safeExecute
};
