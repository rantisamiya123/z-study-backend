const express = require('express');
const auth = require('../middleware/auth.middleware');
const conversationController = require('../controllers/conversation.controller');

const router = express.Router();

// Get all conversations for the authenticated user
router.get(
  '/',
  auth(),
  conversationController.getUserConversations
);

// Get a specific conversation by ID
router.get(
  '/:conversationId',
  auth(),
  conversationController.getConversationById
);

// Delete a conversation
router.delete(
  '/:conversationId',
  auth(),
  conversationController.deleteConversation
);

// Update conversation title
router.patch(
  '/:conversationId',
  auth(),
  conversationController.updateConversation
);

module.exports = router;