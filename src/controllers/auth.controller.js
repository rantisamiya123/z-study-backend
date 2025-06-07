const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync.util');
const authService = require('../services/auth.service');
const tokenService = require('../services/token.service');
const userService = require('../services/user.service');

/**
 * Register user
 */
const register = catchAsync(async (req, res, next) => {
  const user = await authService.register(req.body);
  const tokens = await tokenService.generateAuthTokens(user);
  
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Registration successful',
    data: {
      userId: user,
      email: user.email,
      name: user.name,
      token: tokens.token
    }
  });
});

/**
 * Login user
 */
const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;
  const user = await authService.login(email, password);
  const tokens = await tokenService.generateAuthTokens(user);
  
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Login successful',
    data: {
      token: tokens.token,
      refreshToken: tokens.refreshToken,
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        balance: user.balance,
        role: user.role
      }
    }
  });
});

/**
 * Refresh tokens
 */
const refreshToken = catchAsync(async (req, res) => {
  const { refreshToken } = req.body;
  const tokens = await tokenService.refreshAuth(refreshToken);
  
  res.status(httpStatus.OK).send({
    success: true,
    data: {
      token: tokens.token,
      refreshToken: tokens.refreshToken
    }
  });
});

/**
 * Google OAuth login
 */
const googleAuth = catchAsync(async (req, res) => {
  // Redirect to Google OAuth (implementation will depend on your OAuth setup)
  // In a real implementation, you would:
  // 1. Initialize passport with Google strategy
  // 2. Use passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next)
  
  // For now, just return a message that this would redirect to Google
  res.status(httpStatus.OK).send({
    message: 'This would redirect to Google OAuth'
  });
});

/**
 * Google OAuth callback
 */
const googleCallback = catchAsync(async (req, res) => {
  // Handle Google OAuth callback
  // Real implementation would use the profile received from Google to log in or register the user
  
  res.status(httpStatus.OK).send({
    message: 'Google OAuth callback - would return token on success'
  });
});

/**
 * Verify token
 */
const verifyToken = catchAsync(async (req, res) => {
  // The user object is already attached to req by the auth middleware
  // Just return the user info
  
  res.status(httpStatus.OK).send({
    success: true,
    data: {
      userId: req.user.userId,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      balance: req.user.balance
    }
  });
});

/**
 * Logout user
 */
const logout = catchAsync(async (req, res) => {
  try {
    // Extract access token from Authorization header
    const accessToken = req.headers.authorization?.split(' ')[1];
    
    // Get refresh token from request body
    const { refreshToken } = req.body;
    
    // Check if at least one token is provided
    if (!accessToken && !refreshToken) {
      return res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        message: 'No tokens provided for logout'
      });
    }
    
    // Call the auth service logout that delegates to token service
    const result = await authService.logout(accessToken, refreshToken);
    
    res.status(httpStatus.OK).json({
      success: true,
      message: result.message
    });
  } catch (error) {
    console.error('Error in logout controller:', error);
    res.status(error.statusCode || httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || 'Failed to logout'
    });
  }
});

module.exports = {
  register,
  login,
  refreshToken,
  googleAuth,
  googleCallback,
  verifyToken,
  logout
};