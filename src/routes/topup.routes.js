const express = require('express');
const topupController = require('../controllers/topup.controller');
const auth = require('../middleware/auth.middleware');

const router = express.Router();

// Create topup request
router.post(
  '/create',
  auth(),
  topupController.createTopup
);

// Check topup status
router.get(
  '/status/:topupId',
  auth(),
  topupController.checkStatus
);

// Payment gateway webhook (no auth required, verified by signature)
router.post(
  '/webhook',
  auth(),
  topupController.webhookHandler
);

// Get available payment methods
// router.get(
//   '/payment-methods',
//   auth(),
//   topupController.getPaymentMethods
// );

// Cancel pending topup
// router.post(
//   '/cancel/:topupId',
//   auth(),
//   topupController.cancelTopup
// );

module.exports = router;
