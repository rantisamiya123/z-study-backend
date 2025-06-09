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

// Edit a user message and regenerate assistant response
router.put(
  '/:chatId/edit',
  auth(),
  chatController.editMessage
);

// Switch to a specific version of a chat
router.post(
  '/:chatId/switch-version',
  auth(),
  chatController.switchToVersion
);

// Get all versions of a specific chat
router.get(
  '/:chatId/versions',
  auth(),
  chatController.getChatVersions
);

// Regenerate assistant response
router.post(
  '/:chatId/regenerate',
  auth(),
  chatController.regenerateResponse
);

// Delete a chat
router.delete(
  '/:chatId',
  auth(),
  chatController.deleteChat
);

// Chat completion (non-streaming)
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