const { docClient } = require('../config/dynamodb');
const { PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const httpStatus = require('http-status');
const ApiError = require('../utils/error.util');
const {
  env
} = require("../config/environment");

const TABLE_NAME = `${env.DYNAMODB_TABLE_PREFIX}chats`;

class Chat {
  constructor(data) {
    this.chatId = data.chatId || uuidv4();
    this.conversationId = data.conversationId;
    this.userId = data.userId;
    this.model = data.model;
    
    // Ensure numeric values are properly typed
    this.promptTokens = this.ensureNumber(data.promptTokens, 0);
    this.completionTokens = this.ensureNumber(data.completionTokens, 0);
    this.totalTokens = this.ensureNumber(data.totalTokens, 0);
    this.costUSD = this.ensureNumber(data.costUSD, 0);
    this.costIDR = this.ensureNumber(data.costIDR, 0);
    
    this.content = {
      prompt: data.content?.prompt || null,
      response: data.content?.response || ''
    };
    this.filesUrl = Array.isArray(data.filesUrl) ? data.filesUrl : [];
    this.isEdited = Boolean(data.isEdited);
    this.previousVersions = Array.isArray(data.previousVersions) ? data.previousVersions : [];
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  // Helper method to ensure proper number type
  ensureNumber(value, defaultValue = 0) {
    if (value === null || value === undefined || value === '') {
      return defaultValue;
    }
    const parsed = Number(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  // Helper method to ensure proper string type
  ensureString(value) {
    if (value === null || value === undefined) {
      return null;
    }
    return String(value);
  }

  // Validate and sanitize data before saving
  validateAndSanitize() {
    // Ensure required string fields are strings
    this.conversationId = this.ensureString(this.conversationId);
    this.userId = this.ensureString(this.userId);
    this.model = this.ensureString(this.model);
    this.chatId = this.ensureString(this.chatId);

    // Validate required fields
    if (!this.conversationId || !this.userId || !this.model) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Missing required fields: conversationId, userId, or model');
    }

    // Ensure numeric fields are numbers
    this.promptTokens = this.ensureNumber(this.promptTokens, 0);
    this.completionTokens = this.ensureNumber(this.completionTokens, 0);
    this.totalTokens = this.ensureNumber(this.totalTokens, 0);
    this.costUSD = this.ensureNumber(this.costUSD, 0);
    this.costIDR = this.ensureNumber(this.costIDR, 0);

    // Ensure boolean fields are booleans
    this.isEdited = Boolean(this.isEdited);

    // Ensure array fields are arrays
    this.filesUrl = Array.isArray(this.filesUrl) ? this.filesUrl : [];
    this.previousVersions = Array.isArray(this.previousVersions) ? this.previousVersions : [];

    // Ensure dates are ISO strings
    if (this.createdAt && !(this.createdAt instanceof Date) && typeof this.createdAt === 'string') {
      // Validate ISO string format
      const date = new Date(this.createdAt);
      if (isNaN(date.getTime())) {
        this.createdAt = new Date().toISOString();
      }
    } else if (!this.createdAt) {
      this.createdAt = new Date().toISOString();
    }

    if (this.updatedAt && !(this.updatedAt instanceof Date) && typeof this.updatedAt === 'string') {
      const date = new Date(this.updatedAt);
      if (isNaN(date.getTime())) {
        this.updatedAt = new Date().toISOString();
      }
    } else if (!this.updatedAt) {
      this.updatedAt = new Date().toISOString();
    }
  }

  // Save chat to DynamoDB
  async save() {
    this.updatedAt = new Date().toISOString();
    this.validateAndSanitize();
    
    const params = {
      TableName: TABLE_NAME,
      Item: {
        ...this
      }
    };

    try {
      await docClient.send(new PutCommand(params));
      return this;
    } catch (error) {
      console.error('Error saving chat:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to save chat');
    }
  }

  // Create new chat
  static async create(chatData) {
    // Validate required fields
    if (!chatData.conversationId || !chatData.userId || !chatData.model) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Missing required fields: conversationId, userId, or model');
    }

    if (!chatData.content || !chatData.content.prompt) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Chat content and prompt are required');
    }

    const chat = new Chat(chatData);
    return await chat.save();
  }

  // Find chat by ID
  static async findById(chatId) {
    // Ensure chatId is a string
    const sanitizedChatId = String(chatId);
    
    const params = {
      TableName: TABLE_NAME,
      Key: { chatId: sanitizedChatId }
    };

    try {
      const result = await docClient.send(new GetCommand(params));
      return result.Item ? new Chat(result.Item) : null;
    } catch (error) {
      console.error('Error finding chat by ID:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to find chat by ID');
    }
  }

  // Find chats by conversation ID with pagination
  static async findByConversationId(conversationId, options = {}) {
    // Ensure conversationId is a string
    const sanitizedConversationId = String(conversationId);
    
    // Validate and sanitize options
    const limit = Math.min(Math.max(1, parseInt(options.limit) || 20), 1000); // Between 1 and 1000
    const lastEvaluatedKey = options.lastEvaluatedKey || null;
    const sortOrder = options.sortOrder === 'desc' ? 'desc' : 'asc';
    
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'conversationId-createdAt-index', // GSI on conversationId + createdAt
      KeyConditionExpression: 'conversationId = :conversationId',
      ExpressionAttributeValues: {
        ':conversationId': sanitizedConversationId
      },
      Limit: limit,
      ScanIndexForward: sortOrder === 'asc' // true for ascending, false for descending
    };

    if (lastEvaluatedKey && typeof lastEvaluatedKey === 'object') {
      params.ExclusiveStartKey = lastEvaluatedKey;
    }

    try {
      const result = await docClient.send(new QueryCommand(params));
      return {
        items: result.Items ? result.Items.map(item => new Chat(item)) : [],
        lastEvaluatedKey: result.LastEvaluatedKey,
        count: result.Count || 0
      };
    } catch (error) {
      console.error('Error finding chats by conversation ID:', error);
      console.error('Params:', JSON.stringify(params, null, 2));
      
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to find chats by conversation ID');
    }
  }

  // Find chats by user ID
  static async findByUserId(userId, options = {}) {
    // Ensure userId is a string
    const sanitizedUserId = String(userId);
    
    // Validate and sanitize options
    const limit = Math.min(Math.max(1, parseInt(options.limit) || 20), 1000);
    const lastEvaluatedKey = options.lastEvaluatedKey || null;
    const sortOrder = options.sortOrder === 'asc' ? 'asc' : 'desc';
    
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'userId-createdAt-index', // GSI on userId + createdAt
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': sanitizedUserId
      },
      Limit: limit,
      ScanIndexForward: sortOrder === 'asc'
    };

    if (lastEvaluatedKey && typeof lastEvaluatedKey === 'object') {
      params.ExclusiveStartKey = lastEvaluatedKey;
    }

    try {
      const result = await docClient.send(new QueryCommand(params));
      return {
        items: result.Items ? result.Items.map(item => new Chat(item)) : [],
        lastEvaluatedKey: result.LastEvaluatedKey,
        count: result.Count || 0
      };
    } catch (error) {
      console.error('Error finding chats by user ID:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to find chats by user ID');
    }
  }

  static async countByUserId(userId) {
    // Ensure userId is a string
    const sanitizedUserId = String(userId);
    
    // Note: DynamoDB doesn't have a native count operation for queries
    // so we need to scan or query all items and count them
    // This can be inefficient for large datasets
    
    let count = 0;
    let lastEvaluatedKey = null;

    do {
      const params = {
        TableName: TABLE_NAME,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': sanitizedUserId
        },
        Select: 'COUNT',
        ExclusiveStartKey: lastEvaluatedKey || undefined
      };

      const result = await docClient.send(new QueryCommand(params));
      count += result.Count || 0;
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return count;
  }

  // Count chats by conversation ID
  static async countByConversationId(conversationId) {
    // Ensure conversationId is a string
    const sanitizedConversationId = String(conversationId);
    
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'conversationId-createdAt-index',
      KeyConditionExpression: 'conversationId = :conversationId',
      ExpressionAttributeValues: {
        ':conversationId': sanitizedConversationId
      },
      Select: 'COUNT'
    };

    try {
      const result = await docClient.send(new QueryCommand(params));
      return result.Count || 0;
    } catch (error) {
      console.error('Error counting chats:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to count chats');
    }
  }

  // Get recent chats from a conversation
  static async getRecentChats(conversationId, limit = 10) {
    // Ensure conversationId is a string and limit is a number
    const sanitizedConversationId = String(conversationId);
    const sanitizedLimit = Math.min(Math.max(1, parseInt(limit) || 10), 100);
    
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'conversationId-createdAt-index',
      KeyConditionExpression: 'conversationId = :conversationId',
      ExpressionAttributeValues: {
        ':conversationId': sanitizedConversationId
      },
      Limit: sanitizedLimit,
      ScanIndexForward: false // Most recent first
    };

    try {
      const result = await docClient.send(new QueryCommand(params));
      const chats = result.Items ? result.Items.map(item => new Chat(item)) : [];
      
      // Return in chronological order (oldest first)
      return chats.reverse();
    } catch (error) {
      console.error('Error getting recent chats:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to get recent chats');
    }
  }

  // Update chat
  async update(updateData) {
    // Validate updateData
    if (!updateData || typeof updateData !== 'object') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Update data is required');
    }

    // If updating content, store the previous version
    if (updateData.content) {
      if (!this.previousVersions) {
        this.previousVersions = [];
      }
      
      this.previousVersions.push({
        prompt: this.content.prompt,
        response: this.content.response,
        editedAt: new Date().toISOString()
      });
      
      this.isEdited = true;
    }

    // Update properties with type safety
    Object.keys(updateData).forEach(key => {
      if (key === 'promptTokens' || key === 'completionTokens' || key === 'totalTokens' || key === 'costUSD' || key === 'costIDR') {
        this[key] = this.ensureNumber(updateData[key], 0);
      } else if (key === 'isEdited') {
        this[key] = Boolean(updateData[key]);
      } else if (key === 'filesUrl' || key === 'previousVersions') {
        this[key] = Array.isArray(updateData[key]) ? updateData[key] : [];
      } else {
        this[key] = updateData[key];
      }
    });

    this.updatedAt = new Date().toISOString();

    // Build dynamic update expression
    const updateExpressions = ['#updatedAt = :updatedAt'];
    const attributeNames = { '#updatedAt': 'updatedAt' };
    const attributeValues = { ':updatedAt': this.updatedAt };

    Object.keys(updateData).forEach((key, index) => {
      const attributeName = `#attr${index}`;
      const attributeValue = `:val${index}`;
      
      updateExpressions.push(`${attributeName} = ${attributeValue}`);
      attributeNames[attributeName] = key;
      
      // Ensure proper type for the value
      let value = updateData[key];
      if (key === 'promptTokens' || key === 'completionTokens' || key === 'totalTokens' || key === 'costUSD' || key === 'costIDR') {
        value = this.ensureNumber(value, 0);
      } else if (key === 'isEdited') {
        value = Boolean(value);
      } else if (key === 'filesUrl' || key === 'previousVersions') {
        value = Array.isArray(value) ? value : [];
      }
      
      attributeValues[attributeValue] = value;
    });

    if (this.isEdited) {
      updateExpressions.push('#isEdited = :isEdited');
      attributeNames['#isEdited'] = 'isEdited';
      attributeValues[':isEdited'] = this.isEdited;
    }

    if (this.previousVersions.length > 0) {
      updateExpressions.push('#previousVersions = :previousVersions');
      attributeNames['#previousVersions'] = 'previousVersions';
      attributeValues[':previousVersions'] = this.previousVersions;
    }

    const params = {
      TableName: TABLE_NAME,
      Key: { chatId: this.chatId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: attributeNames,
      ExpressionAttributeValues: attributeValues
    };

    try {
      await docClient.send(new UpdateCommand(params));
      return this;
    } catch (error) {
      console.error('Error updating chat:', error);
      console.error('Update params:', JSON.stringify(params, null, 2));
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to update chat');
    }
  }

  // Delete chat
  async delete() {
    const params = {
      TableName: TABLE_NAME,
      Key: { chatId: this.chatId }
    };

    try {
      await docClient.send(new DeleteCommand(params));
      return true;
    } catch (error) {
      console.error('Error deleting chat:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to delete chat');
    }
  }

  // Delete chats by conversation ID
  static async deleteByConversationId(conversationId) {
    try {
      // First, get all chats for the conversation
      const chats = await Chat.findByConversationId(conversationId, { limit: 1000 });
      
      if (chats.items.length === 0) {
        return 0;
      }

      // Delete all chats in batches to avoid overwhelming DynamoDB
      const batchSize = 25; // DynamoDB batch limit
      const batches = [];
      
      for (let i = 0; i < chats.items.length; i += batchSize) {
        batches.push(chats.items.slice(i, i + batchSize));
      }

      let deletedCount = 0;
      for (const batch of batches) {
        const deletePromises = batch.map(chat => chat.delete());
        await Promise.all(deletePromises);
        deletedCount += batch.length;
      }
      
      return deletedCount;
    } catch (error) {
      console.error('Error deleting chats by conversation ID:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to delete chats');
    }
  }

  // Convert to JSON
  toJSON() {
    return {
      chatId: this.chatId,
      conversationId: this.conversationId,
      userId: this.userId,
      model: this.model,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.totalTokens,
      costUSD: this.costUSD,
      costIDR: this.costIDR,
      content: this.content,
      filesUrl: this.filesUrl,
      isEdited: this.isEdited,
      previousVersions: this.previousVersions,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Chat;