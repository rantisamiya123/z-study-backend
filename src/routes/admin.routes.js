const express = require('express');
const adminController = require('../controllers/admin.controller');
const auth = require('../middleware/auth.middleware');
// const validate = require('../middleware/validation.middleware');
// const adminValidation = require('../validations/admin.validation');

const router = express.Router();

// Admin login
router.post(
  '/login',
  // validate(adminValidation.login),
  adminController.login
);

// Get dashboard statistics
router.get(
  '/dashboard',
  auth(),
  adminController.getDashboardStats
);

// Get users list
// router.get(
//   '/users',
//   auth('admin'),
//   // validate(adminValidation.getUsers),
//   adminController.getUsers
// );

// Get user details
// router.get(
//   '/users/:userId',
//   auth('admin'),
//   // validate(adminValidation.getUserById),
//   adminController.getUserDetails
// );

// Update user status (active/banned)
// router.patch(
//   '/users/:userId/status',
//   auth('admin'),
//   // validate(adminValidation.updateUserStatus),
//   adminController.updateUserStatus
// );

// Delete user
// router.delete(
//   '/users/:userId',
//   auth('admin'),
//   // validate(adminValidation.getUserById),
//   adminController.deleteUser
// );

// Update exchange rate
// router.put(
//   '/settings/exchange-rate',
//   auth('admin'),
//   // validate(adminValidation.updateExchangeRate),
//   adminController.updateExchangeRate
// );

// Get all topup transactions
// router.get(
//   '/topups',
//   auth('admin'),
//   // validate(adminValidation.getPaginatedData),
//   adminController.getAllTopups
// );

// Get all chat usage
// router.get(
//   '/chats',
//   auth('admin'),
//   // validate(adminValidation.getPaginatedData),
//   adminController.getAllChats
// );

// Create admin user (restricted to super admin)
// router.post(
//   '/create',
//   auth('admin'),
//   validate(adminValidation.createAdmin),
//   adminController.createAdmin
// );

// Update app settings
// router.put(
//   '/settings',
//   auth('admin'),
//   // validate(adminValidation.updateSettings),
//   adminController.updateSettings
// );

module.exports = router;
