const { docClient } = require('../config/dynamodb');
const { PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const httpStatus = require('http-status');
const ApiError = require('../utils/error.util');
const { env } = require("../config/environment");

const TABLE_NAME = `${env.DYNAMODB_TABLE_PREFIX}conversations`;

class Conversation {
  constructor(data) {
    this.conversationId = data.conversationId || uuidv4();
    this.userId = data.userId;
    this.title = data.title || 'New Conversation';
    this.lastMessageAt = data.lastMessageAt 
      ? typeof data.lastMessageAt === 'string' 
        ? data.lastMessageAt 
        : new Date(data.lastMessageAt).toISOString()
      : new Date().toISOString();
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  // Save conversation to DynamoDB
  async save() {
    this.updatedAt = new Date().toISOString();
    
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
      console.error('Error saving conversation:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to save conversation');
    }
  }

  // Create new conversation
  static async create(conversationData) {
    // Validate required fields
    if (!conversationData.userId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'User ID is required');
    }

    const conversation = new Conversation(conversationData);
    return await conversation.save();
  }

  // Find conversation by ID
  static async findById(conversationId) {
    const params = {
      TableName: TABLE_NAME,
      Key: { conversationId }
    };

    try {
      const result = await docClient.send(new GetCommand(params));
      return result.Item ? new Conversation(result.Item) : null;
    } catch (error) {
      console.error('Error finding conversation by ID:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to find conversation');
    }
  }

  // Find conversations by user ID with pagination and sorting
  static async findByUserId(userId, options = {}) {
    const { limit = 20, lastEvaluatedKey = null, sortOrder = 'desc' } = options;
    
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'userId-lastMessageAt-index', // GSI on userId and lastMessageAt
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      },
      Limit: limit,
      ScanIndexForward: sortOrder === 'asc' // false for desc, true for asc
    };

    if (lastEvaluatedKey) {
      params.ExclusiveStartKey = lastEvaluatedKey;
    }

    try {
      const result = await docClient.send(new QueryCommand(params));
      return {
        items: result.Items ? result.Items.map(item => new Conversation(item)) : [],
        lastEvaluatedKey: result.LastEvaluatedKey,
        count: result.Count
      };
    } catch (error) {
      console.error('Error finding conversations by user ID:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to find conversations');
    }
  }

  // Update conversation
  async update(updateData) {
    const allowedFields = ['title', 'lastMessageAt'];
    const updateExpression = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key) && updateData[key] !== undefined) {
        updateExpression.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = key === 'lastMessageAt' 
          ? (typeof updateData[key] === 'string' ? updateData[key] : new Date(updateData[key]).toISOString())
          : updateData[key];
      }
    });

    if (updateExpression.length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'No valid fields to update');
    }

    // Always update the updatedAt field
    updateExpression.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = new Date().toISOString();

    const params = {
      TableName: TABLE_NAME,
      Key: { conversationId: this.conversationId },
      UpdateExpression: `SET ${updateExpression.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    try {
      const result = await docClient.send(new UpdateCommand(params));
      return result.Attributes ? new Conversation(result.Attributes) : null;
    } catch (error) {
      console.error('Error updating conversation:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to update conversation');
    }
  }

  // Delete conversation
  async delete() {
    const params = {
      TableName: TABLE_NAME,
      Key: { conversationId: this.conversationId }
    };

    try {
      await docClient.send(new DeleteCommand(params));
      return true;
    } catch (error) {
      console.error('Error deleting conversation:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to delete conversation');
    }
  }

  // Delete conversation by ID
  static async deleteById(conversationId) {
    const conversation = await Conversation.findById(conversationId);
    if (conversation) {
      return await conversation.delete();
    }
    return false;
  }

  // Delete all conversations for a user
  static async deleteAllUserConversations(userId) {
    const result = await Conversation.findByUserId(userId, { limit: 1000 });
    
    if (result.items.length === 0) {
      return 0;
    }

    const deletePromises = result.items.map(conversation => conversation.delete());
    await Promise.all(deletePromises);
    
    return result.items.length;
  }

  // Update last message timestamp
  static async updateLastMessageTime(conversationId) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
    }

    return await conversation.update({ lastMessageAt: new Date() });
  }

  // Count conversations by user ID
  static async countByUserId(userId) {
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'userId-lastMessageAt-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      },
      Select: 'COUNT'
    };

    try {
      const result = await docClient.send(new QueryCommand(params));
      return result.Count || 0;
    } catch (error) {
      console.error('Error counting conversations:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to count conversations');
    }
  }

  // Find or create conversation
  static async findOrCreate(userId, conversationId = null) {
    let conversation = null;
    
    if (conversationId) {
      conversation = await Conversation.findById(conversationId);
      
      // Check if conversation belongs to the user
      if (conversation && conversation.userId !== userId) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Access denied to this conversation');
      }
    }
    
    if (!conversation) {
      conversation = await Conversation.create({ userId });
    }
    
    return conversation;
  }

  // Convert to JSON
  toJSON() {
    return {
      conversationId: this.conversationId,
      userId: this.userId,
      title: this.title,
      lastMessageAt: this.lastMessageAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Conversation;