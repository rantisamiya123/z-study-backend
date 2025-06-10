const express = require('express');
const chatController = require('../controllers/chat.controller');
const auth = require('../middleware/auth.middleware');

const router = express.Router();

/**
 * Chat History Routes
 */

// Get chat history for a conversation with lazy loading support
// GET /api/chat/conversation/:conversationId
// Query params: limit, lastEvaluatedKey, sortOrder, includeVersions
router.get(
  '/conversation/:conversationId',
  auth(),
  chatController.getConversationChats
);

// Get a specific chat by ID with full versioning details
// GET /api/chat/:chatId
router.get(
  '/:chatId',
  auth(),
  chatController.getChatById
);

/**
 * Chat Creation Routes
 */

// Create new chat with streaming response
// POST /api/chat/stream
// Body: { model, messages, max_tokens?, conversationId? }
router.post(
  '/stream',
  auth(),
  chatController.chatCompletionStream
);

// Process file with chat completion (streaming)
// POST /api/chat/process-file/stream
// Body: { fileId, model, prompt, max_tokens?, conversationId? }
router.post(
  '/process-file/stream',
  auth(),
  chatController.processFileStream
);

/**
 * Chat Editing Routes
 */

// Edit user message and auto-complete with streaming (RECOMMENDED)
// PUT /api/chat/:chatId/edit-and-complete
// Body: { content, model, autoComplete? }
router.put(
  '/:chatId/edit-and-complete',
  auth(),
  chatController.editUserMessageAndComplete
);

// Edit user message only (no auto-completion)
// PUT /api/chat/:chatId/edit
// Body: { content }
router.put(
  '/:chatId/edit',
  auth(),
  chatController.editUserMessage
);

/**
 * Response Generation Routes
 */

// Generate new assistant response for a user message (streaming)
// POST /api/chat/:chatId/generate
// Body: { model }
router.post(
  '/:chatId/generate',
  auth(),
  chatController.generateResponse
);

/**
 * Versioning Routes
 */

// Switch to a specific version of a chat
// POST /api/chat/:chatId/switch-version
// Body: { versionNumber }
router.post(
  '/:chatId/switch-version',
  auth(),
  chatController.switchToVersion
);

// Get all versions of a specific chat with pagination
// GET /api/chat/:chatId/versions
// Query params: limit, page
router.get(
  '/:chatId/versions',
  auth(),
  chatController.getChatVersions
);

/**
 * Chat Management Routes
 */

// Delete a chat message (soft delete)
// DELETE /api/chat/:chatId
router.delete(
  '/:chatId',
  auth(),
  chatController.deleteChat
);

module.exports = router;