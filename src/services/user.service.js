const httpStatus = require('http-status');
const User = require('../models/user.model');
const ApiError = require('../utils/error.util');
const bcrypt = require('bcryptjs');

const getUserById = async (userId) => {
  try {
    if (!userId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user ID');
    }
    
    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }
    
    return user;
  } catch (error) {
    throw error;
  }
};

const getUserByEmail = async (email) => {
  try {
    const user = await User.findByEmail(email);
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }
    
    return user;
  } catch (error) {
    throw error;
  }
};

const updateUserProfile = async (userId, updateData) => {
  try {
    if (!userId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user ID');
    }
    
    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }
    
    // Handle password update separately to hash it
    if (updateData.password) {
      const passwordRegex = /^(?=.*\d)(?=.*[!@#$%^&*])(?=.*[a-z])(?=.*[A-Z]).{8,}$/;
      if (!passwordRegex.test(updateData.password)) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Password must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, one number, and one special character'
        );
      }
      
      user.password = updateData.password;
    }
    
    // Update other fields
    const allowedUpdates = ['name'];
    allowedUpdates.forEach((field) => {
      if (updateData[field] !== undefined) {
        user[field] = updateData[field];
      }
    });
    
    await user.save();
    return user;
  } catch (error) {
    throw error;
  }
};

const updateBalance = async (userId, amount) => {
  try {
    console.log(userId, amount);
    
    if (!userId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user ID');
    }
    
    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }
    
    if (amount < 0 && user.balance + amount < 0) {
      throw new ApiError(httpStatus.PAYMENT_REQUIRED, 'Insufficient balance');
    }
    
    const updatedUser = await User.updateUserBalance(userId, amount);
    
    return {
      userId: updatedUser.userId,
      newBalance: updatedUser.balance,
      adjustment: amount
    };
  } catch (error) {
    console.log(error);
    throw error;
  }
};

const getUserProfile = async (userId) => {
  try {
    const user = await getUserById(userId);
    
    return {
      userId: user.userId,
      email: user.email,
      name: user.name,
      balance: user.balance,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  } catch (error) {
    throw error;
  }
};

const createAdminUser = async (userData) => {
  try {
    const emailTaken = await User.isEmailTaken(userData.email);
    if (emailTaken) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
    }
    
    const user = new User({
      ...userData,
      role: 'admin',
      balance: 0,
      status: 'active'
    });
    
    await user.save();
    return user;
  } catch (error) {
    throw error;
  }
};

module.exports = {
  getUserById,
  getUserByEmail,
  updateUserProfile,
  updateBalance,
  getUserProfile,
  createAdminUser
};