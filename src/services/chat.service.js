const httpStatus = require('http-status');
const Chat = require('../models/chat.model');
const conversationService = require('./conversation.service');
const ApiError = require('../utils/error.util');

/**
 * Create a new chat message
 * @param {Object} chatData - Chat data
 * @returns {Promise<Chat>} - Created chat
 */
const createChat = async (chatData) => {
  try {
    const chat = await Chat.create(chatData);

    // Update the conversation's lastMessageAt
    await conversationService.updateLastMessageTime(chatData.conversationId);

    return chat;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create chat');
  }
};

/**
 * Get chat history for a conversation with pagination
 * @param {string} conversationId - Conversation ID
 * @param {string} userId - User ID (for authorization)
 * @param {Object} options - Query options (pagination)
 * @returns {Promise<Object>} - Paginated chats
 */
const getConversationChats = async (conversationId, userId, options = {}) => {
  try {
    // Verify the conversation exists and belongs to the user
    await conversationService.getConversationById(conversationId, userId);

    const {
      limit = 20, lastEvaluatedKey = null, sortOrder = 'asc'
    } = options;

    const result = await Chat.findByConversationId(conversationId, {
      limit,
      lastEvaluatedKey,
      sortOrder
    });

    const count = await Chat.countByConversationId(conversationId);

    return {
      results: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      limit,
      totalResults: count,
      hasMore: !!result.lastEvaluatedKey
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to get conversation chats');
  }
};

/**
 * Get a chat by ID
 * @param {string} chatId - Chat ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Chat>} - Chat
 */
const getChatById = async (chatId, userId) => {
  try {
    if (!chatId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Chat ID is required');
    }

    const chat = await Chat.findById(chatId);

    if (!chat) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Chat not found');
    }

    // Ensure the chat belongs to the user
    if (chat.userId !== userId) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Access denied to this chat');
    }

    return chat;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to get chat by ID');
  }
};

/**
 * Update a chat message
 * @param {string} chatId - Chat ID
 * @param {Object} updateData - Data to update
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Chat>} - Updated chat
 */
const updateChat = async (chatId, updateData, userId) => {
  try {
    const chat = await getChatById(chatId, userId);

    // Update the chat using the model's update method
    const updatedChat = await chat.update(updateData);

    // Update conversation's lastMessageAt timestamp
    await conversationService.updateLastMessageTime(chat.conversationId);

    return updatedChat;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to update chat');
  }
};

/**
 * Delete a chat message
 * @param {string} chatId - Chat ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<void>}
 */
const deleteChat = async (chatId, userId) => {
  try {
    const chat = await getChatById(chatId, userId);
    await chat.delete();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to delete chat');
  }
};

/**
 * Record chat usage data
 * @param {Object} chatData - Chat usage data
 * @param {string} chatData.userId - User ID
 * @param {string} chatData.conversationId - Conversation ID (optional)
 * @param {string} chatData.model - Model name
 * @param {number} chatData.promptTokens - Prompt tokens
 * @param {number} chatData.completionTokens - Completion tokens
 * @param {number} chatData.totalTokens - Total tokens
 * @param {number} chatData.costUSD - Cost in USD
 * @param {number} chatData.costIDR - Cost in IDR
 * @param {Object} chatData.content - Chat content
 * @param {Array} chatData.filesUrl - File URLs (optional)
 * @returns {Promise<Chat>} - Created chat
 */
const recordChatUsage = async (chatData) => {
  try {
    // Find or create a conversation if not provided
    if (!chatData.conversationId) {
      const conversation = await conversationService.createConversation(chatData.userId);
      chatData.conversationId = conversation.conversationId; // Assuming DynamoDB conversation model uses conversationId
    }

    return createChat(chatData);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to record chat usage');
  }
};

/**
 * Get the most recent chats from a conversation
 * @param {string} conversationId - Conversation id
 * @param {number} limit - Number of most recent chats to retrieve
 * @returns {Promise<Array>}
 */
const getRecentChats = async (conversationId, limit = 10) => {
  try {
    return await Chat.getRecentChats(conversationId, limit);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to get recent chats');
  }
};

/**
 * Get user's chat history with pagination
 * @param {string} userId - User ID
 * @param {Object} options - Query options (pagination)
 * @returns {Promise<Object>} - Paginated user chats
 */
const getUserChats = async (userId, options = {}) => {
  try {
    const {
      limit = 20, lastEvaluatedKey = null, sortOrder = 'desc'
    } = options;

    const result = await Chat.findByUserId(userId, {
      limit,
      lastEvaluatedKey,
      sortOrder
    });

    return {
      results: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      limit,
      hasMore: !!result.lastEvaluatedKey
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to get user chats');
  }
};

/**
 * Delete all chats for a conversation
 * @param {string} conversationId - Conversation ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<number>} - Number of deleted chats
 */
const deleteConversationChats = async (conversationId, userId) => {
  try {
    // Verify the conversation belongs to the user
    await conversationService.getConversationById(conversationId, userId);

    return await Chat.deleteByConversationId(conversationId);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to delete conversation chats');
  }
};

/**
 * Get chat statistics for a user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Chat statistics
 */
const getChatStats = async (userId) => {
  try {
    // Get user's chats to calculate stats
    const result = await Chat.findByUserId(userId, {
      limit: 1000
    }); // Adjust limit as needed
    const chats = result.items;

    const stats = {
      totalChats: chats.length,
      totalTokens: chats.reduce((sum, chat) => sum + (chat.totalTokens || 0), 0),
      totalCostUSD: chats.reduce((sum, chat) => sum + (chat.costUSD || 0), 0),
      totalCostIDR: chats.reduce((sum, chat) => sum + (chat.costIDR || 0), 0),
      modelsUsed: [...new Set(chats.map(chat => chat.model))],
      averageTokensPerChat: chats.length > 0 ?
        chats.reduce((sum, chat) => sum + (chat.totalTokens || 0), 0) / chats.length : 0
    };

    return stats;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to get chat statistics');
  }
};

/**
 * Get user's chat history with pagination
 * @param {string} userId - User ID
 * @param {Object} options - Pagination options
 * @param {number} options.page - Page number (default: 1)
 * @param {number} options.limit - Items per page (default: 10)
 * @returns {Promise<Object>} - Paginated chat history
 */
const getUserChatHistory = async (userId, options = {}) => {
  try {
    const {
      page = 1, limit = 10
    } = options;
    const sanitizedPage = Math.max(1, parseInt(page, 10));
    const sanitizedLimit = Math.min(Math.max(1, parseInt(limit, 10)), 100);

    // We'll use DynamoDB pagination (lastEvaluatedKey) to implement our page-based pagination
    let lastEvaluatedKey = null;
    let items = [];
    let totalCount = 0;
    let pagesScanned = 0;
    let totalPages = 0;

    // First, get the total count of chats for this user
    const countResult = await Chat.countByUserId(userId);
    totalCount = countResult;
    totalPages = Math.ceil(totalCount / sanitizedLimit);

    // If the requested page is beyond the total pages, return empty results
    if (sanitizedPage > totalPages && totalPages > 0) {
      return {
        chats: [],
        pagination: {
          total: totalCount,
          page: sanitizedPage,
          limit: sanitizedLimit,
          pages: totalPages
        }
      };
    }

    // Fetch items until we reach the desired page
    while (pagesScanned < sanitizedPage) {
      const result = await Chat.findByUserId(userId, {
        limit: sanitizedLimit,
        lastEvaluatedKey,
        sortOrder: 'desc' // Assuming we want newest chats first
      });

      items = result.items;
      lastEvaluatedKey = result.lastEvaluatedKey;
      pagesScanned++;

      // If there are no more items, break the loop
      if (!lastEvaluatedKey) {
        break;
      }
    }

    // Format the response according to the specification
    const formattedChats = items.map(chat => ({
      chatId: chat.chatId,
      model: chat.model,
      promptTokens: chat.promptTokens,
      completionTokens: chat.completionTokens,
      totalTokens: chat.totalTokens,
      cost: chat.costIDR, // Assuming costIDR is the field in IDR
      createdAt: chat.createdAt
    }));

    return {
      chats: formattedChats,
      pagination: {
        total: totalCount,
        page: sanitizedPage,
        limit: sanitizedLimit,
        pages: totalPages
      }
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to get user chat history');
  }
};

/**
 * Process chat history updates and save new messages
 * @param {Object} params - Processing parameters
 */
/**
 * Process chat history updates and save new messages
 * @param {Object} params - Processing parameters
 */
const processChatHistoryUpdates = async (params) => {
  const {
    userId,
    conversationId,
    chatHistory,
    newUserMessage,
    assistantResponse,
    model,
    usage
  } = params;

  try {
    // Process updates for existing messages with updated = true
    const updatePromises = chatHistory
      .filter(chat => chat.updated === true && chat.chatId)
      .map(async (chat) => {
        try {
          const existingChat = await Chat.findById(chat.chatId);
          if (existingChat && existingChat.userId === userId) {
            // Update content based on role
            const updateData = {
              content: {
                prompt: chat.role === 'user' ? chat.content : existingChat.content.prompt,
                response: chat.role === 'assistant' ? chat.content : existingChat.content.response
              }
            };

            await existingChat.update(updateData);
            return {
              chatId: chat.chatId,
              status: 'updated'
            };
          }
          return {
            chatId: chat.chatId,
            status: 'not_found'
          };
        } catch (error) {
          console.error(`Error updating chat ${chat.chatId}:`, error);
          return {
            chatId: chat.chatId,
            status: 'error',
            error: error.message
          };
        }
      });

    const updateResults = await Promise.allSettled(updatePromises);
    const successfulUpdates = updateResults
      .filter(result => result.status === 'fulfilled' && result.value.status === 'updated')
      .length;

    // Save new user message
    const newChatData = {
      conversationId,
      userId,
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      costUSD: usage.costUSD,
      costIDR: usage.costIDR,
      content: {
        prompt: [newUserMessage],
        response: assistantResponse
      },
    };

    const newChat = await Chat.create(newChatData);

    // Save new assistant response
    // const assistantChatData = {
    //     conversationId,
    //     userId,
    //     model,
    //     promptTokens: usage.promptTokens,
    //     completionTokens: usage.completionTokens,
    //     totalTokens: usage.totalTokens,
    //     costUSD: usage.costUSD,
    //     costIDR: usage.costIDR,
    //     content: {
    //         prompt: null,
    //         response: assistantResponse
    //     }
    // };

    // const assistantChat = await Chat.create(assistantChatData);

    return {
      userChat: {
        chatId: newChat.chatId,
        role: 'user',
        content: newChat.content.prompt
      },
      assistantChat: {
        chatId: newChat.chatId,
        role: 'assistant',
        content: newChat.content.response
      },
      updatedChats: successfulUpdates,
      updateResults: updateResults.map(result =>
        result.status === 'fulfilled' ? result.value : {
          status: 'failed'
        }
      )
    };

  } catch (error) {
    console.error('Error processing chat history updates:', error);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to process chat updates');
  }
};

module.exports = {
  createChat,
  getConversationChats,
  getChatById,
  updateChat,
  deleteChat,
  recordChatUsage,
  getRecentChats,
  getUserChats,
  deleteConversationChats,
  getChatStats,
  getUserChatHistory,
  processChatHistoryUpdates
};