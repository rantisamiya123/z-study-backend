const httpStatus = require('http-status');
const conversationService = require('../services/conversation.service');
const pick = require('../utils/pick.util');
const catchAsync = require('../utils/catchAsync.util');
const ApiError = require('../utils/error.util');

/**
 * Get all conversations for the authenticated user
 */
const getUserConversations = catchAsync(async (req, res) => {
  const { userId } = req.user;
  const options = pick(req.query, ['limit', 'page', 'sortBy']);
  
  const conversations = await conversationService.getUserConversations(userId, options);
  res.status(httpStatus.OK).send(conversations);
});

/**
 * Get a specific conversation by ID
 */
const getConversationById = catchAsync(async (req, res) => {
  const { conversationId } = req.params;
  const { userId } = req.user;
  
  const conversation = await conversationService.getConversationById(conversationId, userId);
  res.status(httpStatus.OK).send(conversation);
});

/**
 * Update a conversation (title, etc.)
 */
const updateConversation = catchAsync(async (req, res) => {
  const { conversationId } = req.params;
  const { userId } = req.user;
  const updateBody = pick(req.body, ['title']);
  
  const conversation = await conversationService.updateConversation(conversationId, updateBody, userId);
  res.status(httpStatus.OK).send(conversation);
});

/**
 * Delete a conversation
 */
const deleteConversation = catchAsync(async (req, res) => {
  const { conversationId } = req.params;
  const { userId } = req.user;
  
  await conversationService.deleteConversation(conversationId, userId);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  getUserConversations,
  getConversationById,
  updateConversation,
  deleteConversation,
};