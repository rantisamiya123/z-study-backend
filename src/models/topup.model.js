const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, UpdateCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../config/dynamodb');
const httpStatus = require('http-status');
const ApiError = require('../utils/error.util');
const { env } = require('../config/environment');

const TABLE_NAME = `${env.DYNAMODB_TABLE_PREFIX}topups`;

class Topup {
  constructor(data) {
    this.topupId = data.topupId || uuidv4();
    this.userId = data.userId;
    this.amount = data.amount;
    this.status = data.status || 'pending';
    this.paymentMethod = data.paymentMethod || 'unknown';
    this.paymentDetails = data.paymentDetails || {};
    this.paymentReference = data.paymentReference || null;
    this.externalId = data.externalId || null;
    this.expiredAt = data.expiredAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    this.paymentUrl = data.paymentUrl || null;
    this.notes = data.notes || '';
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  toJSON() {
    return { ...this };
  }

  async save() {
    this.updatedAt = new Date().toISOString();
    const params = {
      TableName: TABLE_NAME,
      Item: { ...this }
    };

    try {
      await docClient.send(new PutCommand(params));
      return this;
    } catch (error) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to save topup');
    }
  }

  static async create(data) {
    const topup = new Topup(data);
    await topup.save();
    return topup;
  }

  static async getById(topupId) {
    const params = {
      TableName: TABLE_NAME,
      Key: { topupId }
    };

    try {
      const result = await docClient.send(new GetCommand(params));
      return result.Item ? new Topup(result.Item) : null;
    } catch (error) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to get topup');
    }
  }

  static async findOne(query) {
    try {
      // First try with the primary key
      if (query.topupId) {
        const item = await this.getById(query.topupId);
        if (item && (!query.userId || item.userId === query.userId)) {
          return item;
        }
        return null;
      }

      // Fallback to other queries if needed
      const params = {
        TableName: TABLE_NAME,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': query.userId
        },
        Limit: 1,
        ScanIndexForward: false
      };

      const result = await docClient.send(new QueryCommand(params));
      return result.Items?.[0] ? new Topup(result.Items[0]) : null;
    } catch (error) {
      console.error('Error finding topup:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to find topup');
    }
  }

  static async countByUser(userId) {
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'userId-createdAt-index',
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
      console.error('Error counting topups:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to count topups');
    }
  }

  static async findByUser(userId, options = {}) {
    const { 
      limit = 10, 
      lastEvaluatedKey = null,
      status = null,
      sortDirection = 'DESC' 
    } = options;

    const params = {
      TableName: TABLE_NAME,
      IndexName: status ? 'userId-status-index' : 'userId-createdAt-index',
      KeyConditionExpression: status 
        ? 'userId = :userId AND #status = :status'
        : 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      },
      ExpressionAttributeNames: status ? { '#status': 'status' } : undefined,
      Limit: limit,
      ScanIndexForward: sortDirection === 'ASC',
      ExclusiveStartKey: lastEvaluatedKey || undefined
    };

    if (status) {
      params.ExpressionAttributeValues[':status'] = status;
    }

    try {
      const result = await docClient.send(new QueryCommand(params));
      return {
        items: result.Items?.map(item => new Topup(item)) || [],
        lastEvaluatedKey: result.LastEvaluatedKey
      };
    } catch (error) {
      console.error('Error finding topups by user:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to fetch topups');
    }
  }

  static async findByStatus(status, options = {}) {
    const { 
      limit = 10, 
      lastEvaluatedKey = null,
      userId = null,
      sortDirection = 'DESC' 
    } = options;

    const params = {
      TableName: TABLE_NAME,
      IndexName: 'status-createdAt-index',
      KeyConditionExpression: userId
        ? '#status = :status AND userId = :userId'
        : '#status = :status',
      ExpressionAttributeValues: {
        ':status': status
      },
      ExpressionAttributeNames: { '#status': 'status' },
      Limit: limit,
      ScanIndexForward: sortDirection === 'ASC',
      ExclusiveStartKey: lastEvaluatedKey || undefined
    };

    if (userId) {
      params.IndexName = 'userId-status-index';
      params.ExpressionAttributeValues[':userId'] = userId;
    }

    try {
      const result = await docClient.send(new QueryCommand(params));
      return {
        items: result.Items?.map(item => new Topup(item)) || [],
        lastEvaluatedKey: result.LastEvaluatedKey
      };
    } catch (error) {
      console.error('Error finding topups by status:', error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to fetch topups by status');
    }
  }

  static async updateStatus(topupId, newStatus) {
    const params = {
      TableName: TABLE_NAME,
      Key: { topupId },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': newStatus,
        ':updatedAt': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    };

    try {
      const result = await docClient.send(new UpdateCommand(params));
      return new Topup(result.Attributes);
    } catch (error) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to update topup status');
    }
  }
  static async findWithPagination(userId, options = {}) {
    const {
      limit = 10,
      lastEvaluatedKey = null,
      sortDirection = 'DESC',
      status = null
    } = options;
  
    // Validate input parameters
    if (!userId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'User ID is required');
    }
  
    if (limit < 1 || limit > 100) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Limit must be between 1 and 100');
    }
  
    try {
      const params = {
        TableName: TABLE_NAME,
        IndexName: status ? 'userId-status-index' : 'userId-createdAt-index',
        KeyConditionExpression: status
          ? 'userId = :userId AND #status = :status'
          : 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId
        },
        ExpressionAttributeNames: status ? { '#status': 'status' } : undefined,
        Limit: limit,
        ScanIndexForward: sortDirection === 'ASC',
        ExclusiveStartKey: lastEvaluatedKey || undefined
      };
  
      if (status) {
        params.ExpressionAttributeValues[':status'] = status;
      }
  
      const result = await docClient.send(new QueryCommand(params));
  
      return {
        items: result.Items?.map(item => new Topup(item)) || [],
        lastEvaluatedKey: result.LastEvaluatedKey,
        hasMore: !!result.LastEvaluatedKey
      };
    } catch (error) {
      console.error('Error in findWithPagination:', error);
      
      // Handle specific DynamoDB errors
      if (error.name === 'ResourceNotFoundException') {
        throw new ApiError(httpStatus.NOT_FOUND, 'Table or index not found');
      }
      
      if (error.name === 'ValidationException') {
        // Fallback to scan if index doesn't exist
        if (error.message.includes('index')) {
          console.warn('Index not found, falling back to scan operation');
          return this._fallbackScan(userId, options);
        }
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid query parameters');
      }
  
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Failed to fetch topups',
        { originalError: error.message }
      );
    }
  }
  
  // Fallback scan operation when index is not available
  static async _fallbackScan(userId, options) {
  const {
    limit = 10,
    lastEvaluatedKey = null,
    status = null
  } = options;

  const indexName = status ? 'userId-status-index' : 'userId-createdAt-index'; // Ganti sesuai index yang tersedia

  const params = {
    TableName: TABLE_NAME,
    IndexName: indexName,
    KeyConditionExpression: status
      ? 'userId = :userId AND #status = :status'
      : 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': userId
    },
    ExpressionAttributeNames: status ? { '#status': 'status' } : undefined,
    Limit: limit,
    ExclusiveStartKey: lastEvaluatedKey || undefined,
    ScanIndexForward: false
  };

  if (status) {
    params.ExpressionAttributeValues[':status'] = status;
  }

  try {
    const result = await docClient.send(new QueryCommand(params));
    return {
      items: result.Items?.map(item => new Topup(item)) || [],
      lastEvaluatedKey: result.LastEvaluatedKey,
      hasMore: !!result.LastEvaluatedKey
    };
  } catch (queryError) {
    console.error('Fallback query failed:', queryError);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to fetch topups using fallback query');
  }
}

}


module.exports = Topup;