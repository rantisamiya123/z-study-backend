/**
 * Validasi password kustom
 * @param {string} value - Password yang akan divalidasi
 * @param {Object} helpers - Joi helpers
 * @returns {string|Object} - Password valid atau error
 */
const password = (value, helpers) => {
    if (value.length < 8) {
      return helpers.message('Password must be at least 8 characters');
    }
    if (!value.match(/\d/) || !value.match(/[a-zA-Z]/)) {
      return helpers.message('Password must contain at least 1 letter and 1 number');
    }
    if (!value.match(/[!@#$%^&*(),.?":{}|<>]/)) {
      return helpers.message('Password must contain at least one special character');
    }
    return value;
  };
  
  /**
   * Validasi objectId
   * @param {string} value - ObjectId yang akan divalidasi
   * @param {Object} helpers - Joi helpers
   */
  const objectId = (value, helpers) => {
    if (!value.match(/^[0-9a-fA-F]{24}$/)) {
      return helpers.message('"{{#label}}" must be a valid MongoDB ObjectId');
    }
    return value;
  };
  
  module.exports = {
    password,
    objectId
  };
  