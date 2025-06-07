const httpStatus = require('http-status');
const Conversation = require('../models/conversation.model');
const Chat = require('../models/chat.model');
const ApiError = require('../utils/error.util');
const openrouterService = require('../services/openrouter.service');

/**
 * Create a new conversation
 * @param {string} userId - User ID
 * @param {string} title - Conversation title (optional)
 * @returns {Promise<Conversation>} - Created conversation
 */
const createConversation = async (userId, title = 'New Conversation') => {
  try {
    if (!userId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'User ID is required');
    }

    return await Conversation.create({
      userId,
      title,
      lastMessageAt: new Date()
    });
  } catch (error) {
    console.error('Error creating conversation:', error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create conversation');
  }
};

/**
 * Get all conversations for a user with pagination
 * @param {string} userId - User ID
 * @param {Object} options - Query options (pagination, sorting)
 * @returns {Promise<Object>} - Paginated conversations
 */
const getUserConversations = async (userId, options = {}) => {
  try {
    if (!userId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'User ID is required');
    }

    const { limit = 20, page = 1, sortBy = 'lastMessageAt:desc' } = options;
    
    // Parse sorting
    const [sortField, sortOrder] = sortBy.split(':');
    const validSortFields = ['lastMessageAt', 'createdAt'];
    
    if (!validSortFields.includes(sortField)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid sort field');
    }

    // For DynamoDB pagination, we need to handle it differently
    // Since DynamoDB doesn't support offset-based pagination, we'll simulate it
    let allConversations = [];
    let lastEvaluatedKey = null;
    let fetchedCount = 0;
    const targetStart = (page - 1) * limit;
    const targetEnd = targetStart + limit;

    // Keep fetching until we have enough data or no more data
    do {
      const result = await Conversation.findByUserId(userId, {
        limit: Math.max(50, limit * 2), // Fetch more to handle pagination
        lastEvaluatedKey,
        sortOrder: sortOrder || 'desc'
      });

      allConversations.push(...result.items);
      lastEvaluatedKey = result.lastEvaluatedKey;
      fetchedCount += result.count;

    } while (lastEvaluatedKey && allConversations.length < targetEnd);

    // Apply pagination to the results
    const paginatedResults = allConversations.slice(targetStart, targetEnd);
    
    // Get total count for pagination info
    const totalCount = await Conversation.countByUserId(userId);
    
    return {
      results: paginatedResults,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
      totalResults: totalCount
    };
  } catch (error) {
    console.error('Error getting user conversations:', error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to get conversations');
  }
};

/**
 * Get a conversation by ID
 * @param {string} conversationId - Conversation ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Conversation>} - Conversation
 */
const getConversationById = async (conversationId, userId) => {
  try {
    if (!conversationId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Conversation ID is required');
    }

    if (!userId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'User ID is required');
    }

    const conversation = await Conversation.findById(conversationId);
    
    if (!conversation) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
    }
    
    // Ensure the conversation belongs to the user
    if (conversation.userId !== userId) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Access denied to this conversation');
    }
    
    return conversation;
  } catch (error) {
    console.error('Error getting conversation by ID:', error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to get conversation');
  }
};

/**
 * Update a conversation
 * @param {string} conversationId - Conversation ID
 * @param {Object} updateData - Data to update
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Conversation>} - Updated conversation
 */
const updateConversation = async (conversationId, updateData, userId) => {
  try {
    // First, verify the conversation exists and belongs to the user
    const conversation = await getConversationById(conversationId, userId);
    
    // Validate update data
    const allowedFields = ['title'];
    const filteredUpdateData = {};
    
    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key) && updateData[key] !== undefined) {
        filteredUpdateData[key] = updateData[key];
      }
    });
    
    if (Object.keys(filteredUpdateData).length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'No valid fields to update');
    }
    
    // Validate title if provided
    if (filteredUpdateData.title && typeof filteredUpdateData.title !== 'string') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Title must be a string');
    }
    
    if (filteredUpdateData.title && filteredUpdateData.title.trim().length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Title cannot be empty');
    }
    
    return await conversation.update(filteredUpdateData);
  } catch (error) {
    console.error('Error updating conversation:', error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to update conversation');
  }
};

/**
 * Delete a conversation and its chats
 * @param {string} conversationId - Conversation ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<void>}
 */
const deleteConversation = async (conversationId, userId) => {
  try {
    // First, verify the conversation exists and belongs to the user
    const conversation = await getConversationById(conversationId, userId);
    
    // Delete all chats associated with this conversation
    // Note: This assumes Chat model has similar DynamoDB implementation
    if (Chat.deleteByConversationId) {
      await Chat.deleteByConversationId(conversationId);
    } else {
      // Fallback if Chat model doesn't have this method yet
      console.warn('Chat.deleteByConversationId not implemented, skipping chat deletion');
    }
    
    // Delete the conversation
    await conversation.delete();
  } catch (error) {
    console.error('Error deleting conversation:', error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to delete conversation');
  }
};

/**
 * Update conversation's lastMessageAt timestamp
 * @param {string} conversationId - Conversation ID
 * @returns {Promise<Conversation>} - Updated conversation
 */
const updateLastMessageTime = async (conversationId) => {
  try {
    if (!conversationId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Conversation ID is required');
    }

    return await Conversation.updateLastMessageTime(conversationId);
  } catch (error) {
    console.error('Error updating last message time:', error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to update last message time');
  }
};

/**
 * Find or create a conversation
 * @param {string} userId - User ID
 * @param {string} conversationId - Conversation ID (optional)
 * @param {Array} messages - Messages for title generation (when creating new conversation)
 * @returns {Promise} - Found or created conversation
 */
const findOrCreateConversation = async (userId, conversationId = null, messages = null) => {
  try {
    console.log(conversationId, messages);
    
    if (!userId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'User ID is required');
    }

    // If conversationId is provided, try to find existing conversation
    if (conversationId) {
      const existingConversation = await Conversation.findById(conversationId);
      if (existingConversation && existingConversation.userId === userId) {
        return existingConversation;
      }
    }

    // Create new conversation
    let title = 'New Conversation';
    
    // Generate title if messages are provided
    if (messages && messages.length > 0) {
      try {
        title = await openrouterService.generateConversationTitle(messages);
      } catch (error) {
        console.warn('Failed to generate conversation title, using default:', error.message);
        // Keep default title if generation fails
      }
    }

    const conversationData = {
      userId,
      title,
      conversationId: conversationId || undefined // Let the model generate UUID if not provided
    };

    return await Conversation.create(conversationData);
  } catch (error) {
    console.error('Error finding or creating conversation:', error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to find or create conversation');
  }
};

/**
 * Get conversation statistics for a user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Conversation statistics
 */
const getConversationStats = async (userId) => {
  try {
    if (!userId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'User ID is required');
    }

    const totalCount = await Conversation.countByUserId(userId);
    
    // Get recent conversations (last 10)
    const recentResult = await Conversation.findByUserId(userId, {
      limit: 10,
      sortOrder: 'desc'
    });
    
    return {
      totalConversations: totalCount,
      recentConversations: recentResult.items.length,
      lastActivity: recentResult.items.length > 0 
        ? recentResult.items[0].lastMessageAt 
        : null
    };
  } catch (error) {
    console.error('Error getting conversation stats:', error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to get conversation statistics');
  }
};

module.exports = {
  createConversation,
  getUserConversations,
  getConversationById,
  updateConversation,
  deleteConversation,
  updateLastMessageTime,
  findOrCreateConversation,
  getConversationStats
};