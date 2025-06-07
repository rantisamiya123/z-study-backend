const httpStatus = require('http-status');
const topupService = require('../services/topup.service');
const userService = require('../services/user.service');
const catchAsync = require('../utils/catchAsync.util');
const ApiError = require('../utils/error.util');
const logger = require('../utils/logger.util');
const { env } = require('../config/environment');

/**
 * Create a new topup request
 */
const createTopup = catchAsync(async (req, res) => {
  const { userId } = req.user;
  const { amount } = req.body;
  
  // Validate amount
  if (!amount || amount < 10000) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Minimum topup amount is IDR 10,000');
  }
  
  // Create topup request
  const topup = await topupService.createTopupRequest(userId, amount);
  
  // For now, we're simulating payment gateway integration
  // In production, we would integrate with a real payment provider
  const paymentUrl = `${env.FRONTEND_URL}/payment/process?topupId=${topup.topupId}`;
  
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Topup request created',
    data: {
      topupId: topup.topupId,
      amount: topup.amount,
      status: topup.status,
      paymentUrl
    }
  });
});

/**
 * Check topup status
 */
const checkStatus = catchAsync(async (req, res) => {
  const { userId } = req.user;
  const { topupId } = req.params;
  
  const topup = await topupService.getTopupById(topupId, userId);
  
  if (!topup) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Topup not found');
  }
  
  res.status(httpStatus.OK).send({
    success: true,
    data: {
      topupId: topup.topupId,
      amount: topup.amount,
      status: topup.status,
      createdAt: topup.createdAt,
      updatedAt: topup.updatedAt
    }
  });
});

/**
 * Process payment (simulated for now - would be replaced with real payment integration)
 * This would normally be accessed from the frontend after user completes payment
 */
const processPayment = catchAsync(async (req, res) => {
  const { topupId } = req.params;

  const topup = await topupService.getTopupById(topupId);
  
  if (!topup) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Topup not found');
  }
  
  if (topup.status !== 'pending') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This topup is already processed');
  }
  
  // Update topup status to success
  await topupService.updateTopupStatus(topupId, 'success');
  
  // Add amount to user's balance
  await userService.updateBalance(topup.userId, topup.amount);
  
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Payment processed successfully',
    data: {
      topupId,
      amount: topup.amount,
      status: 'success'
    }
  });
});

/**
 * Webhook endpoint for payment gateway
 * This would receive notifications from the payment provider
 */
const webhookHandler = catchAsync(async (req, res) => {
  const { paymentId, status, signature } = req.body;
  const { userId } = req.user;
  console.log(paymentId);
  

  // Validate signature (in production this would verify data from payment provider)
  // Dummy implementation for now
  const isValid = true; // In reality, verify signature with payment provider
  
  if (!isValid) {
    logger.warn('Invalid payment webhook signature received');
    return res.status(httpStatus.BAD_REQUEST).send({ success: false });
  }
  
  logger.info(`Payment webhook received: ID=${paymentId}, Status=${status}`);
  
  try {
    // Find the topup by payment_id
    
    const topup = await topupService.getTopupByPaymentId(paymentId, userId);
    
    if (!topup) {
      logger.warn(`Topup not found for payment ID ${paymentId}`);
      return res.status(httpStatus.OK).send({ success: true }); // Return 200 to avoid retries
    }
    // Update topup status based on payment status
    if (status === 'success' || status === 'completed' || status === 'paid') {
      await topupService.processPaymentWebhook(topup, userId);
      // await userService.updateBalance(topup.userId, topup.amount);
      logger.info(`Topup ${topup.topupId} processed successfully`);
    } else if (status === 'failed' || status === 'cancelled') {
      await topupService.updateTopupStatus(topup.topupId, 'failed');
      logger.info(`Topup ${topup.topupId} marked as failed`);
    }
    
    // Always respond with 200 to acknowledge receipt
    res.status(httpStatus.OK).send({ success: true });
  } catch (error) {
    console.log(error);
    
    logger.error('Error processing payment webhook:', error);
    // Still return 200 to avoid retries from payment provider
    res.status(httpStatus.OK).send({ success: false });
  }
});

/**
 * Get user's topup history
 */
const getUserTopupHistory = catchAsync(async (req, res) => {
  const { userId } = req.user;
  const { page = 1, limit = 10 } = req.query;
  
  const options = {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10)
  };
  
  const result = await topupService.getTopupHistory(userId, options);
  
  res.status(httpStatus.OK).send({
    success: true,
    data: result
  });
});

module.exports = {
  createTopup,
  checkStatus,
  processPayment,
  webhookHandler,
  getUserTopupHistory
};
