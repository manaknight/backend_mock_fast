const jwt = require("jsonwebtoken");

const TOKEN_EXPIRY_IN_SECONDS = 7200; // 2 hours

/**
 * JWT Service for handling authentication tokens
 * Provides functionality for generating, verifying, and extracting JWT tokens
 */
const JWTService = {
  // Default secret (should be overridden by environment variable)
  secret: process.env.JWT_SECRET || "your-secret-key-change-this-in-production",

  // Token expiration times
  accessTokenExpiry: "2h",
  refreshTokenExpiry: "7d",

  /**
   * Generate access token for user
   * @param {Object} user - User object containing id, email, etc.
   * @returns {string} - JWT access token
   */
  generateAccessToken: (user) => {
    const payload = {
      id: user.id,
      email: user.email,
      type: "access",
    };

    return jwt.sign(payload, JWTService.secret, {
      expiresIn: JWTService.accessTokenExpiry,
      issuer: "vce-api",
      subject: user.id.toString(),
    });
  },

  /**
   * Generate refresh token for user
   * @param {Object} user - User object containing id, email, etc.
   * @returns {string} - JWT refresh token
   */
  generateRefreshToken: (user) => {
    const payload = {
      id: user.id,
      email: user.email,
      type: "refresh",
    };

    return jwt.sign(payload, JWTService.secret, {
      expiresIn: JWTService.refreshTokenExpiry,
      issuer: "vce-api",
      subject: user.id.toString(),
    });
  },

  /**
   * Generate password reset token for user
   * @param {string|number} userId - User ID
   * @returns {string} - JWT reset token (short expiry)
   */
  generateResetToken: (userId) => {
    const payload = {
      id: userId,
      type: "reset",
      purpose: "password_reset",
    };

    return jwt.sign(payload, JWTService.secret, {
      expiresIn: "1h", // Reset tokens expire in 1 hour
      issuer: "vce-api",
      subject: userId.toString(),
    });
  },

  /**
   * Generate both access and refresh tokens
   * @param {Object} user - User object
   * @param {number} [customExpiresIn] - (optional) custom expires_in in seconds
   * @returns {Object} - Object containing both tokens and metadata
   */
  generateTokens: (user, customExpiresIn) => {
    const accessToken = JWTService.generateAccessToken(user);
    const refreshToken = JWTService.generateRefreshToken(user);
    const expiresIn =
      typeof customExpiresIn === "number"
        ? customExpiresIn
        : TOKEN_EXPIRY_IN_SECONDS; // fallback

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn, // seconds
      token_type: "Bearer",
      user: {
        id: user.id,
        email: user.email,
      },
    };
  },

  /**
   * Verify JWT token
   * @param {string} token - JWT token to verify
   * @returns {Object} - Decoded token payload
   * @throws {Error} - If token is invalid or expired
   */
  verifyToken: (token) => {
    try {
      return jwt.verify(token, JWTService.secret);
    } catch (error) {
      if (error.name === "JsonWebTokenError") {
        throw new Error("Invalid token");
      } else if (error.name === "TokenExpiredError") {
        throw new Error("Token expired");
      } else {
        throw new Error("Token verification failed");
      }
    }
  },

  /**
   * Extract token from Authorization header
   * @param {string} authHeader - Authorization header value
   * @returns {string|null} - Extracted token or null
   */
  extractTokenFromHeader: (authHeader) => {
    if (!authHeader) {
      return null;
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return null;
    }

    return parts[1];
  },

  /**
   * Get user ID from token
   * @param {string} token - JWT token
   * @returns {string|null} - User ID or null if invalid
   */
  getUserIdFromToken: (token) => {
    try {
      const decoded = JWTService.verifyToken(token);
      return decoded.id;
    } catch (error) {
      return null;
    }
  },

  /**
   * Check if token is expired
   * @param {string} token - JWT token
   * @returns {boolean} - True if token is expired
   */
  isTokenExpired: (token) => {
    try {
      jwt.verify(token, JWTService.secret);
      return false;
    } catch (error) {
      return error.name === "TokenExpiredError";
    }
  },

  /**
   * Decode token without verification (useful for debugging)
   * @param {string} token - JWT token
   * @returns {Object|null} - Decoded token payload or null
   */
  decodeToken: (token) => {
    try {
      return jwt.decode(token);
    } catch (error) {
      return null;
    }
  },
};

module.exports = JWTService;
