const httpStatus = require('http-status');
const User = require('../models/user.model');
const Topup = require('../models/topup.model');
const Chat = require('../models/chat.model');
const ApiError = require('../utils/error.util');
const mongoose = require('mongoose');

/**
 * Admin login service
 * @param {string} email - Admin email
 * @param {string} password - Admin password
 * @returns {Promise<Object>} Auth tokens and admin user data
 */
const loginAdmin = async (email, password) => {
  try {
    if (!email || !password) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Email and password are required');
    }

    const admin = await User.findOne({ email, role: 'admin' });
    
    if (!admin) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid email or password');
    }

    if (admin.status !== 'active') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Admin account is disabled');
    }

    const isPasswordMatch = await admin.isPasswordMatch(password);
    if (!isPasswordMatch) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid email or password');
    }
    
    await User.updateOne(
      { _id: admin._id },
      { lastLogin: new Date() }
    );
    
    // Return admin data and token
    return admin;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Authentication failed');
  }
};

/**
 * Get dashboard statistics for admin
 * @returns {Promise<Object>} Dashboard statistics
 */
const getDashboardStats = async () => {
  try {
    // Get total users count
    const totalUsers = await User.countDocuments({ role: 'user' });

    // Get active users (logged in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const activeUsers = await User.countDocuments({
      role: 'user',
      lastLogin: { $gte: thirtyDaysAgo }
    });

    // Get total topup amount
    const topupAggregate = await Topup.aggregate([
      { $match: { status: 'success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalTopup = topupAggregate.length > 0 ? topupAggregate[0].total : 0;

    // Get total tokens used
    const tokensAggregate = await Chat.aggregate([
      { $group: { _id: null, totalTokens: { $sum: '$totalTokens' } } }
    ]);
    const totalTokensUsed = tokensAggregate.length > 0 ? tokensAggregate[0].totalTokens : 0;

    // Get daily revenue for the last 14 days
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    
    const dailyRevenue = await Topup.aggregate([
      { 
        $match: { 
          status: 'success',
          createdAt: { $gte: fourteenDaysAgo } 
        } 
      },
      {
        $group: {
          _id: { 
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } 
          },
          amount: { $sum: '$amount' }
        }
      },
      { $sort: { _id: 1 } },
      { $project: { date: '$_id', amount: 1, _id: 0 } }
    ]);

    // Get monthly revenue for the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const monthlyRevenue = await Topup.aggregate([
      { 
        $match: { 
          status: 'success',
          createdAt: { $gte: sixMonthsAgo } 
        } 
      },
      {
        $group: {
          _id: { 
            $dateToString: { format: '%Y-%m', date: '$createdAt' } 
          },
          amount: { $sum: '$amount' }
        }
      },
      { $sort: { _id: 1 } },
      { $project: { month: '$_id', amount: 1, _id: 0 } }
    ]);

    return {
      totalUsers,
      activeUsers,
      totalTopup,
      totalTokensUsed,
      revenueStats: {
        daily: dailyRevenue,
        monthly: monthlyRevenue
      }
    };
  } catch (error) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to fetch dashboard statistics');
  }
};

/**
 * Get all users with pagination and search
 * @param {Object} options - Query options
 * @param {number} options.page - Page number
 * @param {number} options.limit - Page size
 * @param {string} options.search - Search term for name or email
 * @returns {Promise<Object>} Users and pagination info
 */
const getUsers = async (options) => {
  const page = parseInt(options.page, 10) || 1;
  const limit = parseInt(options.limit, 10) || 10;
  const skip = (page - 1) * limit;
  
  let query = { role: 'user' };
  
  if (options.search) {
    query.$or = [
      { name: { $regex: options.search, $options: 'i' } },
      { email: { $regex: options.search, $options: 'i' } }
    ];
  }
  
  const [users, totalUsers] = await Promise.all([
    User.find(query)
      .select('name email balance status createdAt lastLogin')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    User.countDocuments(query)
  ]);
  
  const formattedUsers = users.map(user => ({
    userId: user._id,
    email: user.email,
    name: user.name,
    balance: user.balance,
    status: user.status,
    createdAt: user.createdAt,
    lastLogin: user.lastLogin
  }));
  
  return {
    users: formattedUsers,
    pagination: {
      total: totalUsers,
      page,
      limit,
      pages: Math.ceil(totalUsers / limit)
    }
  };
};

/**
 * Get detailed information about a specific user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User details with history
 */
const getUserDetails = async (userId) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user ID');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }

    // Get topup history
    const topupHistory = await Topup.find({ userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('topupId amount status createdAt')
      .lean();

    // Get usage history
    const usageHistory = await Chat.find({ userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('chatId model totalTokens costIDR createdAt')
      .lean();

    // Format histories
    const formattedTopups = topupHistory.map(topup => ({
      topupId: topup._id,
      amount: topup.amount,
      status: topup.status,
      createdAt: topup.createdAt
    }));

    const formattedUsage = usageHistory.map(chat => ({
      chatId: chat._id,
      model: chat.model,
      totalTokens: chat.totalTokens,
      cost: chat.costIDR,
      createdAt: chat.createdAt
    }));

    return {
      userId: user._id,
      email: user.email,
      name: user.name,
      balance: user.balance,
      status: user.status,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      topupHistory: formattedTopups,
      usageHistory: formattedUsage
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to fetch user details');
  }
};

/**
 * Update user status (active/banned)
 * @param {string} userId - User ID
 * @param {string} status - New status (active/banned)
 * @returns {Promise<void>}
 */
const updateUserStatus = async (userId, status) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user ID');
    }

    if (!['active', 'banned'].includes(status)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid status value');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }

    if (user.role === 'admin') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Cannot update status of admin users');
    }

    await User.updateOne({ _id: userId }, { status });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to update user status');
  }
};

/**
 * Delete a user
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
const deleteUser = async (userId) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user ID');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }

    if (user.role === 'admin') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Cannot delete admin users');
    }

    await User.deleteOne({ _id: userId });
    
    // Optionally, clean up related data (topups, chats, etc.)
    // This can be handled by database cascading or explicitly here
    await Topup.deleteMany({ userId });
    await Chat.deleteMany({ userId });
    
    // Other cleanup as needed...
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to delete user');
  }
};

module.exports = {
  getDashboardStats,
  getUsers,
  getUserDetails,
  updateUserStatus,
  deleteUser,
  loginAdmin
};