const httpStatus = require('http-status');
const userService = require('../services/user.service');
const chatService = require('../services/chat.service');
const topupService = require('../services/topup.service');
const catchAsync = require('../utils/catchAsync.util');
const ApiError = require('../utils/error.util');

/**
 * Get current user profile
 */
const getProfile = catchAsync(async (req, res) => {
  const { userId } = req.user;
  
  const user = await userService.getUserById(userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  
  res.status(httpStatus.OK).send({
    success: true,
    data: {
      userId: user.userId,
      email: user.email,
      name: user.name,
      balance: user.balance,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    }
  });
});

/**
 * Update user profile
 */
const updateProfile = catchAsync(async (req, res) => {
  const { userId } = req.user;
  const { name, password } = req.body;
  
  // Create update object with only provided fields
  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (password !== undefined) updateData.password = password;
  
  // If no fields to update
  if (Object.keys(updateData).length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No fields to update');
  }
  
  const user = await userService.updateUserProfile(userId, updateData);
  
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Profile updated successfully',
    data: {
      userId: user.userId,
      email: user.email,
      name: user.name,
      updatedAt: user.updatedAt
    }
  });
});

/**
 * Get user's topup history
 */
const getTopupHistory = catchAsync(async (req, res) => {
  const { userId } = req.user;
  const { page = 1, limit = 10 } = req.query;
  
  const options = {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10)
  };
  
  const result = await topupService.getTopupHistory(userId, options);
  
  res.status(httpStatus.OK).send({
    success: true,
    data: result
  });
});

/**
 * Get user's chat/LLM usage history
 */
const getChatHistory = catchAsync(async (req, res) => {
  const { userId } = req.user;
  const { page = 1, limit = 10 } = req.query;
  
  const options = {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10)
  };
  
  const result = await chatService.getUserChatHistory(userId, options);
  
  res.status(httpStatus.OK).send({
    success: true,
    data: result
  });
});

/**
 * Get a specific chat by ID
 */
const getChatById = catchAsync(async (req, res) => {
  const { userId } = req.user;
  const { chatId } = req.params;
  
  const chat = await chatService.getChatById(chatId, userId);
  
  if (!chat) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Chat not found');
  }
  
  res.status(httpStatus.OK).send({
    success: true,
    data: chat
  });
});

module.exports = {
  getProfile,
  updateProfile,
  getTopupHistory,
  getChatHistory,
  getChatById
};
