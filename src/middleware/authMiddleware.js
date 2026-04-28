const jwt = require('jsonwebtoken');
const { User, TokenBlacklist } = require('../models');

/**
 * Middleware to verify JWT token and attach user to request
 */
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No token provided.'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    // 1. Check if token is blacklisted (logged out)
    const isBlacklisted = await TokenBlacklist.findOne({ where: { token } });
    if (isBlacklisted) {
      return res.status(401).json({
        success: false,
        message: 'Token has been revoked. Please login again.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token.'
    });
  }
};

/**
 * Middleware to restrict access based on roles
 */
const hasRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied. User not authenticated.'
      });
    }

    // Manager and Operator roles have read-only access to everything
    if (['manager', 'operator'].includes(req.user.role) && req.method === 'GET') {
      return next();
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied. Insufficient clearance.'
      });
    }
    next();
  };
};

/**
 * Middleware to optionally verify JWT token. 
 * If token is present and valid, attaches user to request.
 * If token is missing or invalid, proceeds without error.
 */
const optionalVerifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];

  try {
    const isBlacklisted = await TokenBlacklist.findOne({ where: { token } });
    if (isBlacklisted) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    next();
  }
};

module.exports = {
  verifyToken,
  optionalVerifyToken,
  hasRole
};
