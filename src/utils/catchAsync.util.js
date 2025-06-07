/**
 * Wrapper function to catch errors in async express routes
 * This eliminates the need for try-catch blocks in controller functions
 * 
 * @param {Function} fn - The async controller function
 * @returns {Function} Express middleware function that handles errors
 */
const catchAsync = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => next(err));
  };
  
  module.exports = catchAsync;
  