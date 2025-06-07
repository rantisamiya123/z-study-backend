const httpStatus = require('http-status');
const adminService = require('../services/admin.service');
const userService = require('../services/user.service');
const settingService = require('../services/setting.service');
const catchAsync = require('../utils/catchAsync.util');
const ApiError = require('../utils/error.util');
const tokenService = require('../services/token.service');

/**
 * Admin login
 */
const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  const admin = await adminService.loginAdmin(email, password);
  const tokens = await tokenService.generateAuthTokens(admin);

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Login successful',
    data: {
      token: tokens.token,
      refreshToken: tokens.refreshToken,
      user: {
        userId: admin._id,
        email: admin.email,
        name: admin.name,
        balance: admin.balance,
        role: admin.role
      }
    }
  });
});

/**
 * Get dashboard statistics for admin
 */
const getDashboardStats = catchAsync(async (req, res) => {
  const stats = await adminService.getDashboardStats();
  res.status(httpStatus.OK).send({ success: true, data: stats });
});

/**
 * Get list of users
 */
const getUsers = catchAsync(async (req, res) => {
  const { page = 1, limit = 10, search } = req.query;
  const options = {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    search: search || ''
  };
  
  const result = await userService.getUsers(options);
  res.status(httpStatus.OK).send({ success: true, data: result });
});

/**
 * Get specific user details with their history
 */
const getUserDetails = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const user = await adminService.getUserDetailsById(userId);
  
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  
  res.status(httpStatus.OK).send({ success: true, data: user });
});

/**
 * Update user status (active/banned)
 */
const updateUserStatus = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const { status } = req.body;
  
  if (!['active', 'banned'].includes(status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid status value');
  }
  
  await userService.updateUserProfile(userId, { status });
  
  res.status(httpStatus.OK).send({ 
    success: true, 
    message: 'User status updated successfully' 
  });
});

/**
 * Delete user
 */
const deleteUser = catchAsync(async (req, res) => {
  const { userId } = req.params;
  
  // Check if user exists
  const user = await userService.getUserById(userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  
  await userService.deleteUserById(userId);
  
  res.status(httpStatus.OK).send({
    success: true,
    message: 'User deleted successfully'
  });
});

/**
 * Update USD to IDR exchange rate
 */
const updateExchangeRate = catchAsync(async (req, res) => {
  const { usdToIdr } = req.body;
  
  if (!usdToIdr || isNaN(usdToIdr) || usdToIdr <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid exchange rate value');
  }
  
  const rate = await settingService.updateExchangeRate(parseFloat(usdToIdr));
  
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Exchange rate updated successfully',
    data: { usdToIdr: rate }
  });
});

module.exports = {
  getDashboardStats,
  getUsers,
  getUserDetails,
  updateUserStatus,
  deleteUser,
  updateExchangeRate,
  login
};
