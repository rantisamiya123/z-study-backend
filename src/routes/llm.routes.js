const express = require('express');
const llmController = require('../controllers/llm.controller');
const chatController = require('../controllers/chat.controller');
const auth = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

const router = express.Router();

// Get available models
router.get(
  '/models',
  auth(),
  llmController.getModels
);

// Chat completion (non-streaming) - DEPRECATED, use /chat/stream instead
router.post(
  '/chat',
  auth(),
  llmController.chatCompletion
);

// Chat completion (streaming) - DEPRECATED, use /chat/stream instead
router.post(
  '/chat/stream',
  auth(),
  chatController.chatCompletionStream
);

// Upload file (PDF, image, etc.)
router.post(
  '/upload',
  auth(),
  upload.single('file'),
  llmController.uploadFile
);

// Process uploaded file with LLM - DEPRECATED, use /chat/process-file/stream instead
router.post(
  '/process-file',
  auth(),
  llmController.processFile
);

// Process file with LLM (streaming) - DEPRECATED, use /chat/process-file/stream instead
router.post(
  '/process-file/stream',
  auth(),
  chatController.processFileStream
);

module.exports = router;