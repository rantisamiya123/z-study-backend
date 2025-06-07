const express = require('express');
const userController = require('../controllers/user.controller');
const auth = require('../middleware/auth.middleware');


const router = express.Router();

// Get user profile
router.get(
  '/profile',
  auth(),
  userController.getProfile
);

// Update user profile
router.put(
  '/profile',
  auth(),
  userController.updateProfile
);

// Change password
// router.post(
//   '/change-password',
//   auth(),
//   userController.changePassword
// );

// Get topup history
router.get(
  '/topup/history',
  auth(),
  userController.getTopupHistory
);

// Get chat history
router.get(
  '/chat/history',
  auth(),
  userController.getChatHistory
);

// Get chat messages for a specific chat
router.get(
  '/chat/:chatId',
  auth(),
  userController.getChatById
);

module.exports = router;
