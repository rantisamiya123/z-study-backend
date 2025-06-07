class ApiError extends Error {
    constructor(statusCode, message, isOperational = true, stack = '') {
      super(message);
      this.statusCode = statusCode;
      this.isOperational = isOperational;
      if (stack) {
        this.stack = stack;
      } else {
        Error.captureStackTrace(this, this.constructor);
      }
    }
  }
  
  class ValidationError extends ApiError {
    constructor(message, errors = {}) {
      super(400, message);
      this.errors = errors;
    }
  }
  
  class AuthenticationError extends ApiError {
    constructor(message = 'Authentication failed') {
      super(401, message);
    }
  }
  
  class AuthorizationError extends ApiError {
    constructor(message = 'You do not have permission to perform this action') {
      super(403, message);
    }
  }
  
  class NotFoundError extends ApiError {
    constructor(entity = 'Resource') {
      super(404, `${entity} not found`);
    }
  }
  
  class ConflictError extends ApiError {
    constructor(message = 'Resource already exists') {
      super(409, message);
    }
  }
  
  class RateLimitError extends ApiError {
    constructor(message = 'Too many requests, please try again later') {
      super(429, message);
    }
  }
  
  class InsufficientBalanceError extends ApiError {
    constructor(message = 'Insufficient balance') {
      super(402, message);
    }
  }
  
  module.exports = ApiError;
  module.exports.ValidationError = ValidationError;
  module.exports.AuthenticationError = AuthenticationError;
  module.exports.AuthorizationError = AuthorizationError;
  module.exports.NotFoundError = NotFoundError;
  module.exports.ConflictError = ConflictError;
  module.exports.RateLimitError = RateLimitError;
  module.exports.InsufficientBalanceError = InsufficientBalanceError;
  