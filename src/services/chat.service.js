const httpStatus = require('http-status');
const Chat = require('../models/chat.model');
const conversationService = require('./conversation.service');
const openrouterService = require('./openrouter.service');
const userService = require('./user.service');
const settingService = require('./setting.service');
const ApiError = require('../utils/error.util');
const tokenCounter = require('../utils/tokenCounter.util');

/**
 * Create a new chat message
 * @param {Object} chatData - Chat data
 * @returns {Promise<Chat>} - Created chat
 */
const createChat = async (chatData) => {
  try {
    // Get next message index
    const messageIndex = await Chat.getNextMessageIndex(chatData.conversationId);
    
    const chat = await Chat.create({
      ...chatData,
      messageIndex,
      isActive: true,
      isCurrentVersion: true,
      versionNumber: 1
    });

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
 * Get next message index for a conversation
 * @param {string} conversationId - Conversation ID
 * @returns {Promise<number>} - Next message index
 */
const getNextMessageIndex = async (conversationId) => {
  try {
    return await Chat.getNextMessageIndex(conversationId);
  } catch (error) {
    console.error('Error getting next message index:', error);
    return 0;
  }
};

/**
 * Create a pair of user and assistant messages
 * @param {Object} params - Parameters for creating chat pair
 * @returns {Promise<Object>} - Created user and assistant chats
 */
const createChatPair = async ({
  conversationId,
  userId,
  model,
  userContent,
  assistantContent,
  parentChatId = null,
  usage = {},
  filesUrl = []
}) => {
  try {
    // Get next message indices
    const userMessageIndex = await Chat.getNextMessageIndex(conversationId);
    const assistantMessageIndex = userMessageIndex + 1;

    // Create user message
    const userChat = await Chat.create({
      conversationId,
      userId,
      model,
      role: 'user',
      content: userContent,
      parentChatId,
      messageIndex: userMessageIndex,
      isActive: true,
      isCurrentVersion: true,
      versionNumber: 1,
      filesUrl,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUSD: 0,
      costIDR: 0
    });

    // Create assistant message
    const assistantChat = await Chat.create({
      conversationId,
      userId,
      model,
      role: 'assistant',
      content: assistantContent,
      parentChatId: userChat.chatId,
      messageIndex: assistantMessageIndex,
      isActive: true,
      isCurrentVersion: true,
      versionNumber: 1,
      promptTokens: usage.promptTokens || 0,
      completionTokens: usage.completionTokens || 0,
      totalTokens: usage.totalTokens || 0,
      costUSD: usage.costUSD || 0,
      costIDR: usage.costIDR || 0
    });

    // Update parent-child relationships
    if (parentChatId) {
      const parentChat = await Chat.findById(parentChatId);
      if (parentChat) {
        await parentChat.addChildChatId(userChat.chatId);
      }
    }

    await userChat.addChildChatId(assistantChat.chatId);

    // Update conversation's lastMessageAt
    await conversationService.updateLastMessageTime(conversationId);

    return {
      userChat,
      assistantChat
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create chat pair');
  }
};

/**
 * Edit a user message (creates new version and deactivates subsequent messages)
 * @param {string} chatId - Chat ID to edit
 * @param {string} newContent - New content for the message
 * @param {string} userId - User ID for authorization
 * @returns {Promise<Object>} - Updated chat with versioning info
 */
const editUserMessage = async (chatId, newContent, userId) => {
  try {
    // Get the chat to edit
    const chatToEdit = await getChatById(chatId, userId);
    
    if (chatToEdit.role !== 'user') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Can only edit user messages');
    }

    // Create new version of the user message
    const newUserVersion = await chatToEdit.createNewVersion(newContent);

    // Deactivate all messages after this point in the conversation
    // This creates a branch point where the conversation can diverge
    const deactivatedCount = await newUserVersion.deactivateSubsequentMessages();

    // Get versioning information
    const allVersions = await Chat.findVersionsByOriginalChatId(newUserVersion.originalChatId);
    
    return {
      editedMessage: {
        ...newUserVersion.toJSON(),
        hasMultipleVersions: allVersions.length > 1,
        totalVersions: allVersions.length,
        availableVersions: allVersions.map(v => ({
          versionNumber: v.versionNumber,
          isCurrentVersion: v.isCurrentVersion,
          createdAt: v.createdAt,
          content: v.content.substring(0, 100) + (v.content.length > 100 ? '...' : '')
        }))
      },
      branchInfo: {
        branchCreated: true,
        deactivatedMessagesCount: deactivatedCount,
        message: 'Message edited. Subsequent messages have been deactivated. You can generate a new response or switch between versions.'
      }
    };

  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to edit user message');
  }
};

/**
 * Edit an assistant response (creates new version, no regeneration)
 * @param {string} chatId - Chat ID to edit
 * @param {string} newContent - New content for the response
 * @param {string} userId - User ID for authorization
 * @returns {Promise<Object>} - Updated chat with versioning info
 */
const editAssistantResponse = async (chatId, newContent, userId) => {
  try {
    // Get the chat to edit
    const chatToEdit = await getChatById(chatId, userId);
    
    if (chatToEdit.role !== 'assistant') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Can only edit assistant responses');
    }

    // Create new version of the assistant response
    const newAssistantVersion = await chatToEdit.createNewVersion(newContent);

    // Get versioning information
    const allVersions = await Chat.findVersionsByOriginalChatId(newAssistantVersion.originalChatId);
    
    return {
      editedResponse: {
        ...newAssistantVersion.toJSON(),
        hasMultipleVersions: allVersions.length > 1,
        totalVersions: allVersions.length,
        availableVersions: allVersions.map(v => ({
          versionNumber: v.versionNumber,
          isCurrentVersion: v.isCurrentVersion,
          createdAt: v.createdAt,
          content: v.content.substring(0, 100) + (v.content.length > 100 ? '...' : '')
        }))
      },
      versionInfo: {
        message: 'Response edited successfully. New version created.',
        currentVersion: newAssistantVersion.versionNumber,
        totalVersions: allVersions.length
      }
    };

  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to edit assistant response');
  }
};

/**
 * Generate new assistant response for a user message with streaming
 * @param {string} chatId - User chat ID to generate response for
 * @param {string} userId - User ID for authorization
 * @param {string} model - Model to use for generation
 * @param {Object} res - Express response object for streaming
 * @returns {Promise<void>} - Streams response directly to client
 */
const generateResponseForUserMessage = async (chatId, userId, model, res) => {
  try {
    // Get the user chat
    const userChat = await getChatById(chatId, userId);
    
    if (userChat.role !== 'user') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Can only generate response for user messages');
    }

    // Check if there's already an assistant response
    const existingAssistantChat = await Chat.findByConversationId(userChat.conversationId, {
      limit: 1000,
      activeOnly: true,
      currentVersionOnly: true
    });
    
    const assistantResponse = existingAssistantChat.items.find(chat => 
      chat.parentChatId === userChat.chatId && chat.role === 'assistant'
    );

    // Check user balance
    const user = await userService.getUserById(userId);
    const models = await openrouterService.fetchModels();
    const selectedModel = models.find(m => m.id === model);
    
    if (!selectedModel) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid model selected');
    }

    // Get conversation history up to this user message
    const conversationHistory = await getActiveConversationHistory(
      userChat.conversationId, 
      userChat.messageIndex + 1
    );

    // Prepare messages for OpenRouter
    const messages = conversationHistory.map(chat => ({
      role: chat.role,
      content: chat.content
    }));

    // Estimate cost
    const estimatedPromptTokens = tokenCounter.countTokens(messages);
    const estimatedOutputTokens = Math.min(1000, selectedModel.context_length * 0.2);
    const exchangeRate = await settingService.getExchangeRate();
    const estimatedInputCostUSD = (estimatedPromptTokens / 1000) * selectedModel.pricing.prompt;
    const estimatedOutputCostUSD = (estimatedOutputTokens / 1000) * selectedModel.pricing.completion;
    const estimatedTotalCostUSD = estimatedInputCostUSD + estimatedOutputCostUSD;
    const estimatedTotalCostIDR = estimatedTotalCostUSD * exchangeRate;

    // Check balance
    if (user.balance < estimatedTotalCostIDR) {
      res.write(`data: ${JSON.stringify({ 
        error: 'Insufficient balance for this operation',
        required: estimatedTotalCostIDR,
        current: user.balance
      })}\n\n`);
      return res.end();
    }

    // Start streaming
    const { stream } = await openrouterService.createChatCompletionStream(
      userId, model, messages
    );

    let responseText = '';
    let usage = null;

    stream.on('data', (chunk) => {
      const data = chunk.toString();
      const lines = data.split('\n').filter(line => line.trim().startsWith('data:'));

      for (let line of lines) {
        let dataSliced = line.trim().slice(5).trim();

        while (dataSliced.startsWith('data:')) {
          dataSliced = dataSliced.slice(5).trim();
        }

        try {
          const parsedData = JSON.parse(dataSliced);

          if (parsedData.usage) {
            usage = parsedData.usage;
          }

          if (parsedData.choices && parsedData.choices[0].delta && parsedData.choices[0].delta.content) {
            responseText += parsedData.choices[0].delta.content;
          }

          res.write(`data: ${JSON.stringify(parsedData)}\n\n`);
        } catch (err) {
          console.error('JSON parse error:', err.message, dataSliced);
        }
      }

      if (res.flush) res.flush();
    });

    stream.on('end', async () => {
      res.write('data: [DONE]\n\n');

      try {
        if (usage) {
          const { prompt_tokens, completion_tokens, total_tokens } = usage;
          const inputCostUSD = (prompt_tokens / 1000) * selectedModel.pricing.prompt;
          const outputCostUSD = (completion_tokens / 1000) * selectedModel.pricing.completion;
          const totalCostUSD = inputCostUSD + outputCostUSD;
          const totalCostIDR = totalCostUSD * exchangeRate;

          // Deduct from user balance
          await userService.updateBalance(userId, -totalCostIDR);

          let newAssistantChat;

          if (assistantResponse) {
            // Create new version of existing assistant response
            newAssistantChat = await assistantResponse.createNewVersion(responseText, model);
            newAssistantChat.promptTokens = prompt_tokens;
            newAssistantChat.completionTokens = completion_tokens;
            newAssistantChat.totalTokens = total_tokens;
            newAssistantChat.costUSD = totalCostUSD;
            newAssistantChat.costIDR = totalCostIDR;
            await newAssistantChat.save();
          } else {
            // Create new assistant response
            const assistantMessageIndex = await Chat.getNextMessageIndex(userChat.conversationId);
            newAssistantChat = await Chat.create({
              conversationId: userChat.conversationId,
              userId,
              model,
              role: 'assistant',
              content: responseText,
              parentChatId: userChat.chatId,
              messageIndex: assistantMessageIndex,
              isActive: true,
              isCurrentVersion: true,
              versionNumber: 1,
              promptTokens: prompt_tokens,
              completionTokens: completion_tokens,
              totalTokens: total_tokens,
              costUSD: totalCostUSD,
              costIDR: totalCostIDR
            });

            // Update parent-child relationship
            await userChat.addChildChatId(newAssistantChat.chatId);
          }

          // Get versioning info
          const allVersions = await Chat.findVersionsByOriginalChatId(newAssistantChat.originalChatId);

          res.write(`data: ${JSON.stringify({ 
            usage, 
            cost: { 
              usd: totalCostUSD, 
              idr: totalCostIDR 
            },
            assistantMessage: {
              ...newAssistantChat.toJSON(),
              hasMultipleVersions: allVersions.length > 1,
              totalVersions: allVersions.length,
              isNewVersion: assistantResponse ? true : false
            }
          })}\n\n`);
        }
      } catch (error) {
        console.error('Error saving generated response:', error);
        res.write(`data: ${JSON.stringify({ error: 'Error saving generated response' })}\n\n`);
      }

      res.end();
    });

    stream.on('error', (error) => {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    });

  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to generate response');
  }
};

/**
 * Switch to a specific version of a chat and rebuild conversation thread
 * @param {string} originalChatId - Original chat ID
 * @param {number} versionNumber - Version number to switch to
 * @param {string} userId - User ID for authorization
 * @returns {Promise<Object>} - Switched version and conversation thread
 */
const switchToVersion = async (originalChatId, versionNumber, userId) => {
  try {
    // Get the original chat to verify ownership
    const originalChat = await getChatById(originalChatId, userId);
    
    // Switch to the specified version
    const targetVersion = await Chat.switchToVersion(originalChat.originalChatId, versionNumber);
    
    // Get the conversation thread for this specific version
    const conversationThread = await Chat.getConversationThreadForVersion(
      targetVersion.conversationId, 
      versionNumber, 
      targetVersion.messageIndex
    );

    // Get versioning info
    const allVersions = await Chat.findVersionsByOriginalChatId(targetVersion.originalChatId);

    return {
      switchedToVersion: {
        ...targetVersion.toJSON(),
        hasMultipleVersions: allVersions.length > 1,
        totalVersions: allVersions.length,
        availableVersions: allVersions.map(v => ({
          versionNumber: v.versionNumber,
          isCurrentVersion: v.isCurrentVersion,
          createdAt: v.createdAt,
          content: v.content.substring(0, 100) + (v.content.length > 100 ? '...' : '')
        }))
      },
      conversationThread: conversationThread.map(chat => ({
        ...chat.toJSON(),
        hasMultipleVersions: allVersions.some(v => v.originalChatId === chat.originalChatId && allVersions.length > 1)
      })),
      switchInfo: {
        message: `Successfully switched to version ${versionNumber}`,
        affectedMessages: conversationThread.length
      }
    };

  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to switch to version');
  }
};

/**
 * Get all versions of a specific chat
 * @param {string} originalChatId - Original chat ID
 * @param {string} userId - User ID for authorization
 * @returns {Promise<Array>} - All versions of the chat
 */
const getChatVersions = async (originalChatId, userId) => {
  try {
    // Verify ownership
    const originalChat = await getChatById(originalChatId, userId);
    
    // Get all versions
    const versions = await Chat.findVersionsByOriginalChatId(originalChat.originalChatId);
    
    return versions.map(version => ({
      chatId: version.chatId,
      versionId: version.versionId,
      versionNumber: version.versionNumber,
      isCurrentVersion: version.isCurrentVersion,
      content: version.content,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt,
      editHistory: version.editHistory,
      contentPreview: version.content.substring(0, 200) + (version.content.length > 200 ? '...' : ''),
      wordCount: version.content.split(' ').length,
      characterCount: version.content.length
    }));

  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to get chat versions');
  }
};

/**
 * Get active conversation history up to a specific message index
 * @param {string} conversationId - Conversation ID
 * @param {number} maxMessageIndex - Maximum message index to include
 * @returns {Promise<Array>} - Active conversation history
 */
const getActiveConversationHistory = async (conversationId, maxMessageIndex) => {
  try {
    const result = await Chat.findActiveConversationThread(conversationId, { limit: 1000 });
    
    // Filter messages up to the specified index and sort by messageIndex
    const filteredHistory = result.items
      .filter(chat => chat.messageIndex < maxMessageIndex)
      .sort((a, b) => a.messageIndex - b.messageIndex);

    return filteredHistory;
  } catch (error) {
    console.error('Error getting active conversation history:', error);
    return [];
  }
};

/**
 * Get chat history for a conversation with pagination and versioning info
 * @param {string} conversationId - Conversation ID
 * @param {string} userId - User ID (for authorization)
 * @param {Object} options - Query options (pagination)
 * @returns {Promise<Object>} - Paginated chats with versioning info
 */
const getConversationChats = async (conversationId, userId, options = {}) => {
  try {
    // Verify the conversation exists and belongs to the user
    await conversationService.getConversationById(conversationId, userId);

    const {
      limit = 20, 
      lastEvaluatedKey = null, 
      sortOrder = 'asc',
      activeOnly = true,
      currentVersionOnly = true
    } = options;

    const result = await Chat.findByConversationId(conversationId, {
      limit,
      lastEvaluatedKey,
      sortOrder,
      activeOnly,
      currentVersionOnly
    });

    const count = await Chat.countByConversationId(conversationId);

    // For performance, we don't enhance with version info by default
    // Frontend can request version info separately when needed
    const enhancedChats = result.items.map(chat => ({
      ...chat.toJSON(),
      canEdit: chat.role === 'user' || chat.role === 'assistant'
    }));

    return {
      success: true,
      data: {
        results: enhancedChats,
        lastEvaluatedKey: result.lastEvaluatedKey,
        limit,
        totalResults: count,
        hasMore: !!result.lastEvaluatedKey,
        conversationInfo: {
          conversationId,
          totalMessages: count,
          activeMessages: enhancedChats.length
        }
      }
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to get conversation chats');
  }
};

/**
 * Get a chat by ID with versioning information
 * @param {string} chatId - Chat ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Chat>} - Chat with versioning info
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

    // For content updates, use the createNewVersion method
    if (updateData.content) {
      return await chat.createNewVersion(updateData.content, updateData.model);
    }

    // For other updates, use regular update
    const allowedFields = ['isActive'];
    const filteredUpdateData = {};
    
    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key) && updateData[key] !== undefined) {
        filteredUpdateData[key] = updateData[key];
      }
    });

    if (Object.keys(filteredUpdateData).length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'No valid fields to update');
    }

    // Update the chat
    Object.assign(chat, filteredUpdateData);
    await chat.save();

    // Update conversation's lastMessageAt timestamp
    await conversationService.updateLastMessageTime(chat.conversationId);

    return chat;
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
 * Record chat usage data (legacy method for backward compatibility)
 * @param {Object} chatData - Chat usage data
 * @returns {Promise<Chat>} - Created chat
 */
const recordChatUsage = async (chatData) => {
  try {
    // Find or create a conversation if not provided
    if (!chatData.conversationId) {
      const conversation = await conversationService.createConversation(chatData.userId);
      chatData.conversationId = conversation.conversationId;
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
 * Get the most recent active chats from a conversation
 * @param {string} conversationId - Conversation id
 * @param {number} limit - Number of most recent chats to retrieve
 * @returns {Promise<Array>}
 */
const getRecentChats = async (conversationId, limit = 10) => {
  try {
    return await Chat.getRecentActiveChats(conversationId, limit);
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
    const result = await Chat.findByUserId(userId, {
      limit: 1000
    });
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
 * Get user's chat history with pagination (formatted for API response)
 * @param {string} userId - User ID
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} - Paginated chat history
 */
const getUserChatHistory = async (userId, options = {}) => {
  try {
    const {
      page = 1, limit = 10
    } = options;
    const sanitizedPage = Math.max(1, parseInt(page, 10));
    const sanitizedLimit = Math.min(Math.max(1, parseInt(limit, 10)), 100);

    let lastEvaluatedKey = null;
    let items = [];
    let totalCount = 0;
    let pagesScanned = 0;
    let totalPages = 0;

    const countResult = await Chat.countByUserId(userId);
    totalCount = countResult;
    totalPages = Math.ceil(totalCount / sanitizedLimit);

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

    while (pagesScanned < sanitizedPage) {
      const result = await Chat.findByUserId(userId, {
        limit: sanitizedLimit,
        lastEvaluatedKey,
        sortOrder: 'desc'
      });

      items = result.items;
      lastEvaluatedKey = result.lastEvaluatedKey;
      pagesScanned++;

      if (!lastEvaluatedKey) {
        break;
      }
    }

    const formattedChats = items.map(chat => ({
      chatId: chat.chatId,
      model: chat.model,
      role: chat.role,
      promptTokens: chat.promptTokens,
      completionTokens: chat.completionTokens,
      totalTokens: chat.totalTokens,
      cost: chat.costIDR,
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

module.exports = {
  createChat,
  createChatPair,
  getNextMessageIndex,
  editUserMessage,
  editAssistantResponse,
  generateResponseForUserMessage,
  switchToVersion,
  getChatVersions,
  getActiveConversationHistory,
  getConversationChats,
  getChatById,
  updateChat,
  deleteChat,
  recordChatUsage,
  getRecentChats,
  getUserChats,
  deleteConversationChats,
  getChatStats,
  getUserChatHistory
};