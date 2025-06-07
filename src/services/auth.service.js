const httpStatus = require('http-status');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/user.model');
const ApiError = require('../utils/error.util');
const { env } = require('../config/environment');
const tokenService = require('../services/token.service');

/**
 * Register a new user
 * @param {Object} userData - User data
 * @param {string} userData.email - User email
 * @param {string} userData.password - User password
 * @param {string} userData.name - User name
 * @returns {Promise<User>} Newly created user
 */
const register = async (userData) => {
  try {
    // Check if email is already taken
    const emailTaken = await User.isEmailTaken(userData.email);
    if (emailTaken) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
    }

    // Password strength validation
    const passwordRegex = /^(?=.*\d)(?=.*[!@#$%^&*])(?=.*[a-z])(?=.*[A-Z]).{8,}$/;
    if (!passwordRegex.test(userData.password)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Password must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, one number, and one special character'
      );
    }

    // Create new user
    const user = new User({
      ...userData,
      role: 'user', // Default role
      balance: 0,    // Initial balance
      status: 'active'
    });

    await user.save();
    return user;
  } catch (error) {
    throw error;
  }
};

/**
 * Authenticate with email and password
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<User>} Authenticated user
 */
const login = async (email, password) => {
  try {
    const user = await User.findByCredentials(email, password);
    
    // Update last login timestamp
    await User.updateLastLogin(user.userId);
    
    return user;
  } catch (error) {
    throw error;
  }
};

/**
 * Authenticate or create user with Google profile
 * @param {Object} profile - Google profile data
 * @returns {Promise<User>} User
 */
const googleAuth = async (profile) => {
  try {
    const { sub: googleId, email, name } = profile;

    // Try to find user by Google ID first
    let user = await User.findByGoogleId(googleId);
    
    // If not found by Google ID, try to find by email
    if (!user) {
      try {
        user = await User.findByEmail(email);
        if (user && !user.googleId) {
          // Link Google ID to existing account
          await User.updateGoogleId(user.userId, googleId);
          user.googleId = googleId;
        }
      } catch (error) {
        // User not found by email, will create new user below
        user = null;
      }
    }

    if (!user) {
      // Create new user with Google data
      user = new User({
        googleId,
        email,
        name,
        role: 'user',
        balance: 0,
        status: 'active'
      });
      
      await user.save();
    }

    if (user.status === 'banned') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Your account has been banned');
    }

    // Update last login timestamp
    await User.updateLastLogin(user.userId);
    
    return user;
  } catch (error) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Google authentication failed');
  }
};

/**
 * Generate auth tokens for a user
 * @param {User} user - User instance
 * @returns {Promise<Object>} Access and refresh tokens
 */
const generateAuthTokens = async (user) => {
  try {
    const accessToken = jwt.sign(
      {
        sub: user.userId,
        email: user.email,
        role: user.role
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRATION }
    );

    const refreshToken = jwt.sign(
      {
        sub: user.userId
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRATION }
    );

    return {
      token: accessToken,
      refreshToken
    };
  } catch (error) {
    throw error;
  }
};

/**
 * Refresh auth tokens
 * @param {string} refreshToken - Refresh token
 * @returns {Promise<Object>} New access and refresh tokens
 */
const refreshAuth = async (refreshToken) => {
  try {
    const decoded = jwt.verify(refreshToken, env.JWT_SECRET);
    const user = await User.findById(decoded.sub);
    
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }
    
    if (user.status === 'banned') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Your account has been banned');
    }
    
    // Generate new tokens
    return generateAuthTokens(user);
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid refresh token');
    }
    if (error.name === 'TokenExpiredError') {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Refresh token expired');
    }
    throw error;
  }
};

/**
 * Verify a JWT token and return the token payload
 * @param {string} token - JWT token to verify
 * @returns {Promise<Object>} Token payload
 */
const verifyToken = async (token) => {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    const user = await User.findById(decoded.sub);
    
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }
    
    if (user.status === 'banned') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Your account has been banned');
    }
    
    return {
      userId: user.userId,
      email: user.email,
      name: user.name,
      role: user.role,
      balance: user.balance,
    };
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid token');
    }
    if (error.name === 'TokenExpiredError') {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Token expired');
    }
    throw error;
  }
};

const logout = async (accessToken, refreshToken) => {
  try {
    const decoded = jwt.verify(refreshToken, env.JWT_SECRET); 
    const user = await User.findById(decoded.sub);
    
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }

    await tokenService.logout(accessToken, refreshToken);

    return { message: 'Logout successful' };

  } catch (error) {
    throw new ApiError(httpStatus.BAD_REQUEST, error.message || 'Error during logout');
  }
};

module.exports = {
  register,
  login,
  googleAuth,
  generateAuthTokens,
  refreshAuth,
  verifyToken,
  logout
};