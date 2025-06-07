const mongoose = require('mongoose');
const httpStatus = require('http-status');
const Topup = require('../models/topup.model');
const User = require('../models/user.model');
const ApiError = require('../utils/error.util');
const {
  env
} = require('../config/environment');

/**
 * Create a topup request
 * @param {string} userId - User ID
 * @param {number} amount - Topup amount in IDR
 * @returns {Promise<Object>} Topup data with payment URL
 */
const createTopupRequest = async (userId, amount) => {
  try {
    // Validate amount
    if (amount < 10000) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Minimum topup amount is IDR 10,000');
    }

    // Prepare topup data
    const topup = new Topup({
      userId,
      amount,
      status: 'pending',
      paymentMethod: 'pending', // Will be updated when payment is processed
    });

    // Generate invoice ID (used for payment reference)
    const invoiceId = `TOPUP-${topup.topupId}`;

    // Generate dummy payment URL (or integrate with payment gateway)
    const paymentUrl = generatePaymentUrl(invoiceId, amount, userId);
    topup.paymentUrl = paymentUrl;

    // Save topup to DynamoDB
    await topup.save();

    // Return info needed for frontend
    return {
      topupId: topup.topupId,
      amount: topup.amount,
      status: topup.status,
      paymentUrl: topup.paymentUrl,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create topup request');
  }
};

/**
 * Generate payment URL (placeholder implementation)
 * @param {string} invoiceId - Invoice ID 
 * @param {number} amount - Amount in IDR
 * @param {string} userId - User ID
 * @returns {string} Payment URL
 */
const generatePaymentUrl = (invoiceId, amount, userId) => {
  // This is just a placeholder. In production, you'd integrate with a real payment provider
  return `${env.FRONTEND_URL}/payment?invoice=${invoiceId}&amount=${amount}&ref=${userId}`;
};

/**
 * Process payment webhook
 * @param {Object} webhookData - Data from payment gateway
 * @returns {Promise<Boolean>} Success status
 */
const processPaymentWebhook = async (webhookData, userId) => {
  try {
    // Validate signature (in production, verify this with your payment gateway's signature)
    // This is just a placeholder
    const isValid = validateWebhookSignature(webhookData); // Make sure this function is defined
    if (!isValid) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid webhook signature');
    }

    // Extract payment details
    const {
      topupId,
      status: incomingStatus,
      amount
    } = webhookData;

    // Find the topup record
    const topup = await Topup.findOne({
      topupId,
      userId
    });
    if (!topup) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Topup record not found');
    }

    // Check if already processed
    // if (topup.status !== 'pending') {
    //   return true; // Already processed, idempotent
    // }

    // Process the payment based on status
    // const normalizedStatus = incomingStatus.toLowerCase();
    const normalizedStatus = 'success';
    console.log(normalizedStatus);

    if (['success', 'completed', 'settled'].includes(normalizedStatus)) {
      // Update topup status
      topup.status = 'success';
      topup.paymentMethod = webhookData.payment_method || 'unknown';
      topup.paymentDetails = webhookData;
      await topup.save();

      // Add to user balance - DynamoDB version
      await User.updateUserBalance(topup.userId, topup.amount);

      return true;
    } else if (['failed', 'canceled', 'expired'].includes(normalizedStatus)) {
      // Update topup status
      topup.status = 'failed';
      topup.paymentDetails = webhookData;
      await topup.save();

      return true;
    } else {
      // For other statuses (like 'pending'), do nothing
      return true;
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.log(error);

    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to process payment webhook');
  }
};

/**
 * Validate webhook signature (placeholder implementation)
 * @param {Object} webhookData - Webhook data
 * @returns {boolean} Is valid
 */
const validateWebhookSignature = (webhookData) => {
  // In production, implement proper signature validation
  // This is just a placeholder that always returns true
  return true;
};

/**
 * Check topup status
 * @param {string} topupId - Topup ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Object>} Topup data
 */
const checkTopupStatus = async (topupId, userId) => {
  try {

    const topup = await Topup.findOne({
      _id: topupId,
      userId
    });
    if (!topup) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Topup record not found');
    }

    return {
      topupId: topup.topupId,
      amount: topup.amount,
      status: topup.status,
      paymentMethod: topup.paymentMethod,
      createdAt: topup.createdAt,
      updatedAt: topup.updatedAt
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to check topup status');
  }
};

/**
 * Get topup history for a user
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @param {number} options.page - Page number
 * @param {number} options.limit - Items per page
 * @returns {Promise<Object>} Topup history with pagination
 */
const getTopupHistory = async (userId, options = {}) => {
  try {
    const page = parseInt(options.page, 10) || 1;
    const limit = parseInt(options.limit, 10) || 10;

    const {
      items,
      total
    } = await Topup.findWithPagination(userId, page, limit);

    const formattedTopups = items.map(topup => ({
      topupId: topup.topupId,
      amount: topup.amount,
      status: topup.status,
      paymentMethod: topup.paymentMethod,
      createdAt: topup.createdAt
    }));

    return {
      topups: formattedTopups,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    console.log(error)
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to fetch topup history');
  }
};

/**
 * Admin: Manually add balance to user
 * @param {string} userId - User ID
 * @param {number} amount - Amount to add
 * @param {string} adminId - Admin ID (for audit)
 * @returns {Promise<Object>} Updated user balance
 */
const adminAddBalance = async (userId, amount, adminId) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user ID');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }

    // Create topup record
    const topup = await Topup.create({
      userId,
      amount,
      status: 'success',
      paymentMethod: 'admin',
      paymentDetails: {
        adminId,
        note: 'Manual balance addition by admin'
      }
    });

    // Update user balance
    const updatedUser = await User.findByIdAndUpdate(
      userId, {
        $inc: {
          balance: amount
        }
      }, {
        new: true
      }
    );

    return {
      userId: updatedUser.topupId,
      newBalance: updatedUser.balance,
      topupId: topup.topupId,
      addedAmount: amount
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to add balance');
  }
};

/**
 * Get topup by payment ID
 * @param {string} payment_id - Payment ID from the payment gateway
 * @returns {Promise<Object>} Topup data
 */
const getTopupByPaymentId = async (payment_id, userId) => {
  try {

    if (!payment_id) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Payment ID is required');
    }

    const topup = await Topup.findOne({
      topupId: payment_id,
      userId
    });

    if (!topup) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Topup not found for given payment ID');
    }

    return {
      topupId: topup.topupId,
      userId: topup.userId,
      amount: topup.amount,
      status: topup.status,
      paymentMethod: topup.paymentMethod,
      createdAt: topup.createdAt,
      updatedAt: topup.updatedAt,
      paymentDetails: topup.paymentDetails
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to get topup by payment ID');
  }
};

/**
 * Get topup detail by ID
 * @param {string} topupId - Topup ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Object>} Topup detail
 */
const getTopupById = async (topupId, userId) => {
  try {
    console.log('Fetching topup:', {
      topupId,
      userId
    });

    const topup = await Topup.findOne({
      topupId,
      userId
    });
    if (!topup) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Topup not found');
    }

    // Return topup detail
    return {
      topupId: topup.topupId, // Changed from _id to topupId since that's what your model uses
      amount: topup.amount,
      status: topup.status,
      paymentMethod: topup.paymentMethod,
      paymentDetails: topup.paymentDetails || null,
      createdAt: topup.createdAt,
      updatedAt: topup.updatedAt
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to get topup by ID');
  }
};

module.exports = {
  createTopupRequest,
  processPaymentWebhook,
  checkTopupStatus,
  getTopupHistory,
  adminAddBalance,
  getTopupByPaymentId,
  getTopupById
};