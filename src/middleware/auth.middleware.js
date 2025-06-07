const httpStatus = require('http-status');
const ApiError = require('../utils/error.util');
const tokenService = require('../services/token.service');
const userService = require('../services/user.service');

/**
 * Authentication middleware
 * @param {...string} requiredRights - Required roles to access the endpoint
 * @returns {Function} Express middleware
 */
const auth = (...requiredRights) => async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Authorization token missing');
    }

    const accessToken = authHeader.split(' ')[1];

    // Verifikasi token dan cek di database
    const payload = await tokenService.verifyToken(accessToken, 'access');

    const user = await userService.getUserById(payload.sub);
    if (!user) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'User not found');
    }

    if (user.status === 'banned') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Your account has been banned');
    }

    // Cek hak akses
    if (requiredRights.length && !requiredRights.includes(user.role)) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Insufficient permissions');
    }

    // Attach ke request
    req.user = {
      userId: user.userId,
      email: user.email,
      role: user.role,
      name: user.name,
      balance: user.balance
    };

    next();
  } catch (err) {
    next(err);
  }
};

module.exports = auth;
