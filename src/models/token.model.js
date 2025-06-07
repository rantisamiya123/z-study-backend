const { docClient } = require('../config/dynamodb');
const { PutCommand, GetCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const httpStatus = require('http-status');
const ApiError = require('../utils/error.util');
const {
  env
} = require("../config/environment");

const TABLE_NAME = `${env.DYNAMODB_TABLE_PREFIX}tokens`;

class Token {
  constructor(data) {
    this.tokenId = data.tokenId || uuidv4();
    this.token = data.token;
    this.userId = data.userId;
    this.type = data.type; // 'access' or 'refresh'
    this.createdAt = data.createdAt || new Date().toISOString();
    this.expiresAt = data.expiresAt
  ? typeof data.expiresAt === 'string'
    ? data.expiresAt
    : new Date(data.expiresAt).toISOString()
  : null;
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  // Save token to DynamoDB
  async save() {
    this.updatedAt = new Date().toISOString();
    
    const params = {
      TableName: TABLE_NAME,
      Item: {
        ...this,
        ttl: Math.floor(new Date(this.expiresAt).getTime() / 1000) // TTL for automatic deletion
      }
    };

    try {
      await docClient.send(new PutCommand(params));
      return this;
    } catch (error) {
      console.log(error);
      
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to save token');
    }
  }

  // Create new token
  static async create(tokenData) {

    // Validate required fields
    if (!tokenData.token || !tokenData.userId || !tokenData.type || !tokenData.expiresAt) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Missing required fields');
    }

    // Validate token type
    if (!['access', 'refresh'].includes(tokenData.type)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid token type');
    }

    // Check if token already exists
    const existingToken = await Token.findByToken(tokenData.token);
    if (existingToken) {
      throw new ApiError(httpStatus.CONFLICT, 'Token already exists');
    }

    const token = new Token(tokenData);
    return await token.save();
  }

  // Find token by token string - Using QueryCommand with GSI
  static async findByToken(tokenString) {
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'token-index', // GSI on token field
      KeyConditionExpression: '#t = :token',
      ExpressionAttributeNames: {
        '#t': 'token'
      },
      ExpressionAttributeValues: {
        ':token': tokenString
      }
    };

    try {
      const result = await docClient.send(new QueryCommand(params));
      return result.Items && result.Items.length > 0 ? new Token(result.Items[0]) : null;
    } catch (error) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to find token');
    }
  }

  // Find token by ID
  static async findById(tokenId) {
    const params = {
      TableName: TABLE_NAME,
      Key: { tokenId }
    };

    try {
      const result = await docClient.send(new GetCommand(params));
      return result.Item ? new Token(result.Item) : null;
    } catch (error) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to find token by ID');
    }
  }

  // Find token by multiple fields - Using QueryCommand with composite GSI
  static async findByFields(fields) {
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'token-userId-index', // Composite GSI on token + userId
      KeyConditionExpression: '#t = :token AND #u = :userId',
      FilterExpression: '#type = :type', // Use FilterExpression for non-key attributes
      ExpressionAttributeNames: {
        '#t': 'token',
        '#u': 'userId',
        '#type': 'type'
      },
      ExpressionAttributeValues: {
        ':token': fields.token,
        ':userId': fields.userId,
        ':type': fields.type
      }
    };

    try {
      const result = await docClient.send(new QueryCommand(params));
      return result.Items && result.Items.length > 0 ? new Token(result.Items[0]) : null;
    } catch (error) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to find token by fields');
    }
  }

  // Find tokens by user ID
  static async findByUserId(userId, type = null) {
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'userId-index', // GSI on userId field
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      }
    };

    if (type) {
      params.FilterExpression = '#type = :type';
      params.ExpressionAttributeNames = {
        '#type': 'type'
      };
      params.ExpressionAttributeValues[':type'] = type;
    }

    try {
      const result = await docClient.send(new QueryCommand(params));
      return result.Items ? result.Items.map(item => new Token(item)) : [];
    } catch (error) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to find tokens by user ID');
    }
  }

  // Delete token
  async delete() {
    const params = {
      TableName: TABLE_NAME,
      Key: { tokenId: this.tokenId }
    };

    try {
      await docClient.send(new DeleteCommand(params));
      return true;
    } catch (error) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to delete token');
    }
  }

  static async deleteMany(conditions) {
    if (!Array.isArray(conditions)) {
      throw new Error('Conditions must be an array');
    }

    const deleted = [];

    for (const condition of conditions) {
      if (!condition.token) continue;

      const token = await Token.findByToken(condition.token);
      if (token) {
        await token.delete();
        deleted.push(token.token);
      }
    }

    return deleted;
  }

  // Delete token by token string
  static async deleteByToken(tokenString) {
    const token = await Token.findByToken(tokenString);
    if (token) {
      return await token.delete();
    }
    return false;
  }

  // Delete all tokens for a user
  static async deleteAllUserTokens(userId, type = null) {
    const tokens = await Token.findByUserId(userId, type);
    
    if (tokens.length === 0) {
      return 0;
    }

    const deletePromises = tokens.map(token => token.delete());
    await Promise.all(deletePromises);
    
    return tokens.length;
  }

  // Check if token is expired
  isExpired() {
    return new Date() > new Date(this.expiresAt);
  }

  // Check if token is valid (exists and not expired)
  static async isValidToken(tokenString) {
    const token = await Token.findByToken(tokenString);
    return token && !token.isExpired();
  }

  // Clean up expired tokens - Using QueryCommand with GSI on expiresAt
  static async cleanupExpiredTokens() {
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'expiresAt-index', // GSI on expiresAt field
      KeyConditionExpression: 'expiresAt < :now',
      ExpressionAttributeValues: {
        ':now': new Date().toISOString()
      }
    };

    try {
      const result = await docClient.send(new QueryCommand(params));
      if (result.Items && result.Items.length > 0) {
        const deletePromises = result.Items.map(item => {
          const deleteParams = {
            TableName: TABLE_NAME,
            Key: { tokenId: item.tokenId }
          };
          return docClient.send(new DeleteCommand(deleteParams));
        });
        
        await Promise.all(deletePromises);
        return result.Items.length;
      }
      return 0;
    } catch (error) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to cleanup expired tokens');
    }
  }

  // Convert to JSON (similar to User model toJSON transform)
  toJSON() {
    return {
      tokenId: this.tokenId,
      token: this.token,
      userId: this.userId,
      type: this.type,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Token;