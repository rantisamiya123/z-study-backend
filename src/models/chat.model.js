const { docClient } = require('../config/dynamodb');
const { PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
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
    this.role = data.role; // 'user' or 'assistant'
    this.parentChatId = data.parentChatId || null; // Reference to parent message
    this.childChatIds = Array.isArray(data.childChatIds) ? data.childChatIds : []; // Array of child message IDs
    this.messageIndex = this.ensureNumber(data.messageIndex, 0); // Position in conversation thread
    this.isActive = Boolean(data.isActive !== false); // Whether this message is in the active conversation path
    
    // Version control fields
    this.versionId = data.versionId || uuidv4(); // Unique version identifier
    this.originalChatId = data.originalChatId || this.chatId; // Reference to the original chat this is a version of
    this.versionNumber = this.ensureNumber(data.versionNumber, 1); // Version number (1, 2, 3, etc.)
    this.isCurrentVersion = Boolean(data.isCurrentVersion !== false); // Whether this is the current active version
    this.branchPoint = data.branchPoint || null; // The chat ID where this branch started
    this.versionHistory = Array.isArray(data.versionHistory) ? data.versionHistory : []; // Array of version metadata
    
    // Ensure numeric values are properly typed
    this.promptTokens = this.ensureNumber(data.promptTokens, 0);
    this.completionTokens = this.ensureNumber(data.completionTokens, 0);
    this.totalTokens = this.ensureNumber(data.totalTokens, 0);
    this.costUSD = this.ensureNumber(data.costUSD, 0);
    this.costIDR = this.ensureNumber(data.costIDR, 0);
    
    this.content = data.content || '';
    this.filesUrl = Array.isArray(data.filesUrl) ? data.filesUrl : [];
    this.isEdited = Boolean(data.isEdited);
    this.editHistory = Array.isArray(data.editHistory) ? data.editHistory : [];
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
    this.role = this.ensureString(this.role);
    this.versionId = this.ensureString(this.versionId);
    this.originalChatId = this.ensureString(this.originalChatId);

    // Validate required fields
    if (!this.conversationId || !this.userId || !this.role) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Missing required fields: conversationId, userId, or role');
    }

    // Validate role
    if (!['user', 'assistant'].includes(this.role)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Role must be either "user" or "assistant"');
    }

    // Ensure numeric fields are numbers
    this.promptTokens = this.ensureNumber(this.promptTokens, 0);
    this.completionTokens = this.ensureNumber(this.completionTokens, 0);
    this.totalTokens = this.ensureNumber(this.totalTokens, 0);
    this.costUSD = this.ensureNumber(this.costUSD, 0);
    this.costIDR = this.ensureNumber(this.costIDR, 0);
    this.messageIndex = this.ensureNumber(this.messageIndex, 0);
    this.versionNumber = this.ensureNumber(this.versionNumber, 1);

    // Ensure boolean fields are booleans
    this.isEdited = Boolean(this.isEdited);
    this.isActive = Boolean(this.isActive !== false);
    this.isCurrentVersion = Boolean(this.isCurrentVersion !== false);

    // Ensure array fields are arrays
    this.filesUrl = Array.isArray(this.filesUrl) ? this.filesUrl : [];
    this.childChatIds = Array.isArray(this.childChatIds) ? this.childChatIds : [];
    this.editHistory = Array.isArray(this.editHistory) ? this.editHistory : [];
    this.versionHistory = Array.isArray(this.versionHistory) ? this.versionHistory : [];

    // Ensure dates are ISO strings
    if (this.createdAt && !(this.createdAt instanceof Date) && typeof this.createdAt === 'string') {
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
    if (!chatData.conversationId || !chatData.userId || !chatData.role) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Missing required fields: conversationId, userId, or role');
    }

    if (!chatData.content) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Chat content is required');
    }

    const chat = new Chat(chatData);
    return await chat.save();
  }

  // Find chat by ID
  static async findById(chatId) {
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

  // Find all versions of a chat by originalChatId
  static async findVersionsByOriginalChatId(originalChatId) {
    const sanitizedOriginalChatId = String(originalChatId);
    
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'originalChatId-versionNumber-index',
      KeyConditionExpression: 'originalChatId = :originalChatId',
      ExpressionAttributeValues: {
        ':originalChatId': sanitizedOriginalChatId
      },
      ScanIndexForward: true // Order by version number ascending
    };

    try {
      const result = await docClient.send(new QueryCommand(params));
      return result.Items ? result.Items.map(item => new Chat(item)) : [];
    } catch (error) {
      console.error('Error finding versions by original chat ID:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to find chat versions');
    }
  }

  // Find current version of a chat
  static async findCurrentVersion(originalChatId) {
    const versions = await Chat.findVersionsByOriginalChatId(originalChatId);
    return versions.find(version => version.isCurrentVersion) || null;
  }

  // Create a new version of an existing chat
  async createNewVersion(newContent, model) {
    try {
      // Get all existing versions to determine the next version number
      const existingVersions = await Chat.findVersionsByOriginalChatId(this.originalChatId);
      const nextVersionNumber = Math.max(...existingVersions.map(v => v.versionNumber), 0) + 1;

      // Mark all existing versions as not current
      for (const version of existingVersions) {
        if (version.isCurrentVersion) {
          version.isCurrentVersion = false;
          await version.save();
        }
      }

      // Create new version
      const newVersion = new Chat({
        conversationId: this.conversationId,
        userId: this.userId,
        model: model || this.model,
        role: this.role,
        content: newContent,
        messageIndex: this.messageIndex,
        parentChatId: this.parentChatId,
        originalChatId: this.originalChatId,
        versionNumber: nextVersionNumber,
        isCurrentVersion: true,
        isActive: true,
        branchPoint: this.chatId,
        versionHistory: [
          ...this.versionHistory,
          {
            versionNumber: nextVersionNumber,
            createdAt: new Date().toISOString(),
            previousContent: this.content,
            reason: 'user_edit'
          }
        ],
        filesUrl: this.filesUrl,
        isEdited: true
      });

      await newVersion.save();
      return newVersion;
    } catch (error) {
      console.error('Error creating new version:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create new version');
    }
  }

  // Switch to a specific version
  static async switchToVersion(originalChatId, versionNumber) {
    try {
      const versions = await Chat.findVersionsByOriginalChatId(originalChatId);
      const targetVersion = versions.find(v => v.versionNumber === versionNumber);
      
      if (!targetVersion) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Version not found');
      }

      // Mark all versions as not current
      for (const version of versions) {
        if (version.isCurrentVersion) {
          version.isCurrentVersion = false;
          await version.save();
        }
      }

      // Mark target version as current
      targetVersion.isCurrentVersion = true;
      await targetVersion.save();

      return targetVersion;
    } catch (error) {
      console.error('Error switching to version:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to switch to version');
    }
  }

  // Find active conversation thread (only active messages with current versions)
  static async findActiveConversationThread(conversationId, options = {}) {
    const sanitizedConversationId = String(conversationId);
    
    const limit = Math.min(Math.max(1, parseInt(options.limit) || 100), 1000);
    const lastEvaluatedKey = options.lastEvaluatedKey || null;
    
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'conversationId-messageIndex-index',
      KeyConditionExpression: 'conversationId = :conversationId',
      FilterExpression: 'isActive = :isActive AND isCurrentVersion = :isCurrentVersion',
      ExpressionAttributeValues: {
        ':conversationId': sanitizedConversationId,
        ':isActive': true,
        ':isCurrentVersion': true
      },
      Limit: limit,
      ScanIndexForward: true // Order by messageIndex ascending
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
      console.error('Error finding active conversation thread:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to find active conversation thread');
    }
  }

  // Find chats by conversation ID with pagination (all messages including inactive)
  static async findByConversationId(conversationId, options = {}) {
    const sanitizedConversationId = String(conversationId);
    
    const limit = Math.min(Math.max(1, parseInt(options.limit) || 20), 1000);
    const lastEvaluatedKey = options.lastEvaluatedKey || null;
    const sortOrder = options.sortOrder === 'desc' ? 'desc' : 'asc';
    const activeOnly = options.activeOnly === true;
    const currentVersionOnly = options.currentVersionOnly === true;
    
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'conversationId-createdAt-index',
      KeyConditionExpression: 'conversationId = :conversationId',
      ExpressionAttributeValues: {
        ':conversationId': sanitizedConversationId
      },
      Limit: limit,
      ScanIndexForward: sortOrder === 'asc'
    };

    // Build filter expression
    const filterConditions = [];
    if (activeOnly) {
      filterConditions.push('isActive = :isActive');
      params.ExpressionAttributeValues[':isActive'] = true;
    }
    if (currentVersionOnly) {
      filterConditions.push('isCurrentVersion = :isCurrentVersion');
      params.ExpressionAttributeValues[':isCurrentVersion'] = true;
    }

    if (filterConditions.length > 0) {
      params.FilterExpression = filterConditions.join(' AND ');
    }

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
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to find chats by conversation ID');
    }
  }

  // Find chats by user ID
  static async findByUserId(userId, options = {}) {
    const sanitizedUserId = String(userId);
    
    const limit = Math.min(Math.max(1, parseInt(options.limit) || 20), 1000);
    const lastEvaluatedKey = options.lastEvaluatedKey || null;
    const sortOrder = options.sortOrder === 'asc' ? 'asc' : 'desc';
    
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'userId-createdAt-index',
      KeyConditionExpression: 'userId = :userId',
      FilterExpression: 'isCurrentVersion = :isCurrentVersion',
      ExpressionAttributeValues: {
        ':userId': sanitizedUserId,
        ':isCurrentVersion': true
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

  // Deactivate chat and its children from a specific point (for version branching)
  async deactivateFromPoint() {
    try {
      // Find all chats after this message index in the conversation
      const result = await Chat.findByConversationId(this.conversationId, {
        limit: 1000,
        activeOnly: true,
        currentVersionOnly: true
      });

      const chatsToDeactivate = result.items.filter(chat => 
        chat.messageIndex > this.messageIndex
      );

      // Batch update all messages to set isActive = false
      const batchRequests = [];
      
      for (const chat of chatsToDeactivate) {
        batchRequests.push({
          PutRequest: {
            Item: {
              ...chat,
              isActive: false,
              updatedAt: new Date().toISOString()
            }
          }
        });
      }
      
      // Process in batches of 25 (DynamoDB limit)
      const batchSize = 25;
      for (let i = 0; i < batchRequests.length; i += batchSize) {
        const batch = batchRequests.slice(i, i + batchSize);
        
        const params = {
          RequestItems: {
            [TABLE_NAME]: batch
          }
        };
        
        await docClient.send(new BatchWriteCommand(params));
      }
      
      return chatsToDeactivate.length;
    } catch (error) {
      console.error('Error deactivating chats from point:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to deactivate chats from point');
    }
  }

  // Reactivate chat and its children for a specific version
  async reactivateToPoint() {
    try {
      // Find all chats that were part of this version's timeline
      const result = await Chat.findByConversationId(this.conversationId, {
        limit: 1000,
        activeOnly: false,
        currentVersionOnly: false
      });

      // Find chats that should be reactivated based on this version's timeline
      const chatsToReactivate = result.items.filter(chat => {
        // Reactivate chats that are part of this version's branch
        return chat.messageIndex <= this.messageIndex && 
               (chat.branchPoint === this.branchPoint || chat.branchPoint === null);
      });

      // Batch update all messages to set isActive = true
      const batchRequests = [];
      
      for (const chat of chatsToReactivate) {
        batchRequests.push({
          PutRequest: {
            Item: {
              ...chat,
              isActive: true,
              updatedAt: new Date().toISOString()
            }
          }
        });
      }
      
      // Process in batches of 25 (DynamoDB limit)
      const batchSize = 25;
      for (let i = 0; i < batchRequests.length; i += batchSize) {
        const batch = batchRequests.slice(i, i + batchSize);
        
        const params = {
          RequestItems: {
            [TABLE_NAME]: batch
          }
        };
        
        await docClient.send(new BatchWriteCommand(params));
      }
      
      return chatsToReactivate.length;
    } catch (error) {
      console.error('Error reactivating chats to point:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to reactivate chats to point');
    }
  }

  // Get all children recursively
  async getAllChildrenRecursively() {
    const allChildren = [];
    
    if (!this.childChatIds || this.childChatIds.length === 0) {
      return allChildren;
    }
    
    for (const childId of this.childChatIds) {
      const child = await Chat.findById(childId);
      if (child) {
        allChildren.push(child);
        
        // Recursively get children of this child
        const grandChildren = await child.getAllChildrenRecursively();
        allChildren.push(...grandChildren);
      }
    }
    
    return allChildren;
  }

  // Add child chat ID
  async addChildChatId(childChatId) {
    if (!this.childChatIds.includes(childChatId)) {
      this.childChatIds.push(childChatId);
      
      const params = {
        TableName: TABLE_NAME,
        Key: { chatId: this.chatId },
        UpdateExpression: 'SET childChatIds = :childChatIds, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':childChatIds': this.childChatIds,
          ':updatedAt': new Date().toISOString()
        }
      };

      try {
        await docClient.send(new UpdateCommand(params));
        return this;
      } catch (error) {
        console.error('Error adding child chat ID:', error);
        throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to add child chat ID');
      }
    }
    
    return this;
  }

  // Get next message index for conversation
  static async getNextMessageIndex(conversationId) {
    try {
      const result = await Chat.findByConversationId(conversationId, { 
        limit: 1, 
        sortOrder: 'desc',
        currentVersionOnly: true
      });
      
      if (result.items.length === 0) {
        return 0;
      }
      
      return result.items[0].messageIndex + 1;
    } catch (error) {
      console.error('Error getting next message index:', error);
      return 0;
    }
  }

  // Count chats by conversation ID
  static async countByConversationId(conversationId) {
    const sanitizedConversationId = String(conversationId);
    
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'conversationId-createdAt-index',
      KeyConditionExpression: 'conversationId = :conversationId',
      FilterExpression: 'isCurrentVersion = :isCurrentVersion',
      ExpressionAttributeValues: {
        ':conversationId': sanitizedConversationId,
        ':isCurrentVersion': true
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

  // Count chats by user ID
  static async countByUserId(userId) {
    const sanitizedUserId = String(userId);
    
    let count = 0;
    let lastEvaluatedKey = null;

    do {
      const params = {
        TableName: TABLE_NAME,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :userId',
        FilterExpression: 'isCurrentVersion = :isCurrentVersion',
        ExpressionAttributeValues: {
          ':userId': sanitizedUserId,
          ':isCurrentVersion': true
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

  // Get recent active chats from a conversation
  static async getRecentActiveChats(conversationId, limit = 10) {
    const sanitizedConversationId = String(conversationId);
    const sanitizedLimit = Math.min(Math.max(1, parseInt(limit) || 10), 100);
    
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'conversationId-messageIndex-index',
      KeyConditionExpression: 'conversationId = :conversationId',
      FilterExpression: 'isActive = :isActive AND isCurrentVersion = :isCurrentVersion',
      ExpressionAttributeValues: {
        ':conversationId': sanitizedConversationId,
        ':isActive': true,
        ':isCurrentVersion': true
      },
      Limit: sanitizedLimit,
      ScanIndexForward: false // Most recent first by messageIndex
    };

    try {
      const result = await docClient.send(new QueryCommand(params));
      const chats = result.Items ? result.Items.map(item => new Chat(item)) : [];
      
      // Return in chronological order (oldest first)
      return chats.reverse();
    } catch (error) {
      console.error('Error getting recent active chats:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to get recent active chats');
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
      const chats = await Chat.findByConversationId(conversationId, { limit: 1000 });
      
      if (chats.items.length === 0) {
        return 0;
      }

      const batchSize = 25;
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
      role: this.role,
      parentChatId: this.parentChatId,
      childChatIds: this.childChatIds,
      messageIndex: this.messageIndex,
      isActive: this.isActive,
      versionId: this.versionId,
      originalChatId: this.originalChatId,
      versionNumber: this.versionNumber,
      isCurrentVersion: this.isCurrentVersion,
      branchPoint: this.branchPoint,
      versionHistory: this.versionHistory,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.totalTokens,
      costUSD: this.costUSD,
      costIDR: this.costIDR,
      content: this.content,
      filesUrl: this.filesUrl,
      isEdited: this.isEdited,
      editHistory: this.editHistory,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Chat;