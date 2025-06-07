const jwt = require('jsonwebtoken');
const moment = require('moment');
const httpStatus = require('http-status');
const { env } = require('../config/environment');
const ApiError = require('../utils/error.util');
const User = require('../models/user.model');
const Token = require('../models/token.model');

/**
 * Generate access token
 * @param {Object} userInfo - User information
 * @returns {string} JWT token
 */
const generateAccessToken = (userInfo) => {
  try {
    const payload = {
      sub: userInfo.userId,
      email: userInfo.email,
      role: userInfo.role,
      iat: moment().unix(),
      exp: moment().add(
        parseInt(env.JWT_ACCESS_EXPIRATION) || 15, 
        'minutes'
      ).unix()
    };
    
    return jwt.sign(payload, env.JWT_SECRET);
  } catch (error) {
    console.error('Error generating access token:', error);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to generate access token');
  }
};

/**
 * Generate refresh token
 * @param {Object} userInfo - User information
 * @returns {string} JWT refresh token
 */
const generateRefreshToken = (userInfo) => {
  try {
    const payload = {
      sub: userInfo.userId,
      iat: moment().unix(),
      exp: moment().add(
        parseInt(env.JWT_REFRESH_EXPIRATION) || 7,
        'days'
      ).unix()
    };
    
    return jwt.sign(payload, env.JWT_SECRET);
  } catch (error) {
    console.error('Error generating refresh token:', error);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to generate refresh token');
  }
};

/**
 * Generate auth tokens
 * @param {Object} user - User document
 * @returns {Object} Access and refresh tokens
 */
const generateAuthTokens = async (user) => {
  try {
    // Validate user object
    if (!user || (!user.userId)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user object');
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    const accessExpires = moment().add(parseInt(env.JWT_ACCESS_EXPIRATION) || 15, 'minutes').toDate();
    const refreshExpires = moment().add(parseInt(env.JWT_REFRESH_EXPIRATION) || 7, 'days').toDate();

    const userId = user.userId;

    // Create tokens individually to handle any validation errors better
    try {
      await Token.create({
        token: accessToken,
        userId: userId,  // ✅ Fixed: Changed from 'user' to 'userId'
        type: 'access',
        expiresAt: accessExpires,
      });

      await Token.create({
        token: refreshToken,
        userId: userId,  // ✅ Fixed: Changed from 'user' to 'userId'
        type: 'refresh',
        expiresAt: refreshExpires,
      });
    } catch (tokenError) {
      console.error('Token creation error:', tokenError);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to save tokens to database');
    }
    
    return {
      token: accessToken,
      refreshToken,
    };
  } catch (error) {
    console.error('Error generating auth tokens:', error);
    console.error('User object received:', JSON.stringify(user, null, 2));
    
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to generate authentication tokens');
  }
};

/**
 * Verify JWT token
 * @param {string} token - JWT token
 * @param {string} type - Token type (access/refresh)
 * @returns {Object} Decoded token payload
 */
const verifyToken = async (token, type = 'access') => {
  try {
    if (!token) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Token is required');
    }

    const decoded = jwt.verify(token, env.JWT_SECRET);

    // Fetch token from DynamoDB
    const tokenDoc = await Token.findByToken(token);

    // Validate if token matches the user and type
    if (!tokenDoc || tokenDoc.userId !== decoded.sub || tokenDoc.type !== type) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Token not recognized');
    }

    return decoded;
  } catch (error) {
    console.error('Token verification error:', error);

    if (error instanceof ApiError) {
      throw error;
    } else if (error.name === 'TokenExpiredError') {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Token expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid token signature');
    } else {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid token');
    }
  }
};


/**
 * Refresh auth tokens
 * @param {string} refreshToken - Refresh token
 * @returns {Promise<Object>} New auth tokens
 */
const refreshAuth = async (refreshToken) => {
  try {
    if (!refreshToken) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Refresh token is required');
    }

    // Verifikasi token JWT
    const decoded = await verifyToken(refreshToken, 'refresh');

    // Ambil data user dari database
    const user = await User.findById(decoded.sub);
    if (!user) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'User not found');
    }

    if (user.status === 'banned') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Account has been banned');
    }

    // Cari token di DynamoDB berdasarkan token string
    const tokenDoc = await Token.findByToken(refreshToken);

    if (
      !tokenDoc ||
      tokenDoc.userId !== user.userId ||
      tokenDoc.type !== 'refresh'
    ) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Refresh token not found or invalid');
    }

    await Token.deleteByToken(tokenDoc.tokenId);

    // Buat token baru
    return await generateAuthTokens(user);
  } catch (error) {
    console.error('Error refreshing authentication:', error);

    if (error instanceof ApiError) {
      throw error;
    } else {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Failed to refresh authentication');
    }
  }
};

/**
 * Logout user by removing tokens
 * @param {string} accessToken - Access token
 * @param {string} refreshToken - Refresh token
 * @returns {Promise<Object>} Logout result
 */
const logout = async (accessToken, refreshToken) => {
  try {
    const tokensToDelete = [];
    
    if (accessToken) {
      tokensToDelete.push({ token: accessToken }); 
    }
    
    if (refreshToken) {
      tokensToDelete.push({ token: refreshToken }); 
    }

    if (tokensToDelete.length > 0) {
      await Token.deleteMany(tokensToDelete);
    }

    return { message: 'Logout successful' };
  } catch (error) {
    console.error('Error during logout:', error);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to logout');
  }
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateAuthTokens,
  verifyToken,
  refreshAuth,
  logout
};