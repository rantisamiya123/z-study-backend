const { docClient } = require('../config/dynamodb');
const { PutCommand, GetCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const httpStatus = require('http-status');
const ApiError = require('../utils/error.util');
const {
  env
} = require("../config/environment");

const TABLE_NAME = `${env.DYNAMODB_TABLE_PREFIX}users`;

class User {
  constructor(data) {
    this.userId = data.userId || uuidv4();
    this.name = data.name;
    this.email = data.email;
    this.password = data.password;
    this.googleId = data.googleId;
    this.role = data.role || 'user';
    this.balance = data.balance || 0;
    this.status = data.status || 'active';
    this.lastLogin = data.lastLogin;
    this.profilePicture = data.profilePicture;
    this.resetPasswordToken = data.resetPasswordToken;
    this.resetPasswordExpires = data.resetPasswordExpires;
    this.emailVerified = data.emailVerified || false;
    this.emailVerificationToken = data.emailVerificationToken;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  // Validate email format
  static validateEmail(email) {
    return /^\S+@\S+\.\S+$/.test(email);
  }

  // Hash password
  static async hashPassword(password) {
    return bcrypt.hash(password, 10);
  }

  // Compare password
  static async comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

    // Update last login timestamp
  static async updateLastLogin(userId) {
    const params = {
      TableName: TABLE_NAME,
      Key: { userId },
      UpdateExpression: 'set lastLogin = :lastLogin, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':lastLogin': new Date().toISOString(),
        ':updatedAt': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW'
    };

    try {
      const result = await docClient.send(new UpdateCommand(params));
      return result.Attributes ? new User(result.Attributes) : null;
    } catch (error) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to update last login');
    }
  }

  // Save user to DynamoDB
  async save() {
    if (this.password && !this.password.startsWith('$2a$')) {
      this.password = await User.hashPassword(this.password);
    }
    
    this.updatedAt = new Date().toISOString();

    const params = {
      TableName: TABLE_NAME,
      Item: { ...this }
    };

    try {
      await docClient.send(new PutCommand(params));
      return this;
    } catch (error) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to save user');
    }
  }

  // Find user by ID
  static async findById(userId) {
    const params = {
      TableName: TABLE_NAME,
      Key: { userId }
    };

    try {
      const result = await docClient.send(new GetCommand(params));
      return result.Item ? new User(result.Item) : null;
    } catch (error) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to find user');
    }
  }

  // Find user by email (using QueryCommand with GSI)
  static async findByEmail(email) {
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email
      }
    };

    try {
      const result = await docClient.send(new QueryCommand(params));
      return result.Items && result.Items.length > 0 ? new User(result.Items[0]) : null;
    } catch (error) {
      console.log(error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to find user by email');
    }
  }

  // Check if email is taken
  static async isEmailTaken(email, excludeUserId) {
    const user = await User.findByEmail(email);
    if (!user) return false;
    if (excludeUserId && user.userId === excludeUserId) return false;
    return true;
  }

  // Find by credentials
  static async findByCredentials(email, password) {
    const user = await User.findByEmail(email);
    if (!user) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid credentials');
    }
    if (user.status === 'banned') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Account has been banned');
    }
    
    const isMatch = await User.comparePassword(password, user.password);
    if (!isMatch) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid credentials');
    }
    
    return user;
  }

  // Update user balance
  static async updateUserBalance(userId, amount) {

    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }

    const newBalance = user.balance + amount;
    if (newBalance < 0) {
      throw new ApiError(httpStatus.PAYMENT_REQUIRED, 'Insufficient balance');
    }

    const params = {
      TableName: TABLE_NAME,
      Key: { userId },
      UpdateExpression: 'SET balance = :balance, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':balance': newBalance,
        ':updatedAt': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    };

    try {
      const result = await docClient.send(new UpdateCommand(params));
      return new User(result.Attributes);
    } catch (error) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to update balance');
    }
  }

  // Find or create Google user
  static async findOrCreateGoogleUser(googleProfile) {
    // Try to find by Google ID first
    let user = await User.findByGoogleId(googleProfile.id);
    
    if (!user) {
      // Check if email is already registered
      const existingUser = await User.findByEmail(googleProfile.emails[0].value);
      
      if (existingUser) {
        // Link Google ID to existing account
        existingUser.googleId = googleProfile.id;
        if (!existingUser.emailVerified) {
          existingUser.emailVerified = true;
        }
        user = await existingUser.save();
      } else {
        // Create new user
        const newUser = new User({
          googleId: googleProfile.id,
          email: googleProfile.emails[0].value,
          name: googleProfile.displayName,
          emailVerified: true,
          profilePicture: googleProfile.photos && googleProfile.photos.length > 0 
            ? googleProfile.photos[0].value 
            : null
        });
        user = await newUser.save();
      }
    }
    
    return user;
  }

  // Find by Google ID
  static async findByGoogleId(googleId) {
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'googleId-index',
      KeyConditionExpression: 'googleId = :googleId',
      ExpressionAttributeValues: {
        ':googleId': googleId
      }
    };

    try {
      const result = await docClient.send(new QueryCommand(params));
      return result.Items && result.Items.length > 0 ? new User(result.Items[0]) : null;
    } catch (error) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to find user by Google ID');
    }
  }

  // Check password match
  async isPasswordMatch(password) {
    return User.comparePassword(password, this.password);
  }

  // Convert to JSON (similar to Mongoose transform)
  toJSON() {
    const userObject = { ...this };
    delete userObject.password;
    delete userObject.resetPasswordToken;
    delete userObject.resetPasswordExpires;
    delete userObject.emailVerificationToken;
    return userObject;
  }
}

module.exports = User;