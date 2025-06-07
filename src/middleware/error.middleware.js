const mongoose = require('mongoose');
const httpStatus = require('http-status');
const ApiError = require('../utils/error.util');
const { env } = require('../config/environment');
const logger = require('../utils/logger.util');

/**
 * Convert various error types to ApiError
 * @param {Error} err - Error to convert
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const errorConverter = (err, req, res, next) => {
  let error = err;
  
  // If error is not an instance of ApiError, convert it
  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || 
      (error instanceof mongoose.Error ? httpStatus.BAD_REQUEST : httpStatus.INTERNAL_SERVER_ERROR);
    
    const message = error.message || httpStatus[statusCode];
    
    error = new ApiError(statusCode, message, false, err.stack);
  }
  
  next(error);
};

/**
 * Handle API errors and send appropriate response
 * @param {ApiError} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const errorHandler = (err, req, res, next) => {
  const { statusCode, message } = err;
  
  // Set response status
  res.status(statusCode);
  
  // Prepare error response
  const response = {
    success: false,
    code: statusCode,
    message,
    ...(env.NODE_ENV === 'development' && { stack: err.stack }),
  };
  
  // Log error for server-side issues
  if (statusCode >= 500) {
    logger.error(err);
  }
  
  // Send response
  res.json(response);
};

module.exports = {
  errorConverter,
  errorHandler,
};
