const express = require('express');
const chatController = require('../controllers/chat.controller');
const auth = require('../middleware/auth.middleware');

const router = express.Router();

// Get chat history for a conversation
router.get(
  '/conversation/:conversationId',
  auth(),
  chatController.getConversationChats
);

// Get a chat by ID
router.get(
  '/:chatId',
  auth(),
  chatController.getChatById
);

// Update a chat
router.patch(
  '/:chatId',
  auth(),
  chatController.updateChat
);

// Delete a chat
router.delete(
  '/:chatId',
  auth(),
  chatController.deleteChat
);

router.post(
  '/completion',
  auth(),
  chatController.chatCompletion
);

// Chat completion (streaming)
router.post(
  '/stream',
  auth(),
  chatController.chatCompletionStream
);

// Process file with chat completion (streaming)
router.post(
  '/process-file/stream',
  auth(),
  chatController.processFileStream
);

// Retry a chat with the same prompt
router.post(
  '/:chatId/retry',
  auth(),
  chatController.retryChat
);

module.exports = router;