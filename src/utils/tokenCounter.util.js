const { encode } = require('gpt-3-encoder');

/**
 * Count the number of tokens in a string
 * @param {string} text - Text to count tokens for
 * @returns {number} - Number of tokens
 */
const countTokensForString = (text) => {
  if (!text) return 0;
  return encode(text).length;
};

/**
 * Count tokens for a single message
 * @param {Object} message - Message object
 * @returns {number} - Number of tokens
 */
const countMessageTokens = (message) => {
  let tokenCount = 0;
  
  // Count tokens for role (usually 1 token)
  tokenCount += countTokensForString(message.role);
  
  // Count tokens for content
  if (typeof message.content === 'string') {
    tokenCount += countTokensForString(message.content);
  } else if (Array.isArray(message.content)) {
    // Handle multi-modal messages
    message.content.forEach(item => {
      if (item.type === 'text') {
        tokenCount += countTokensForString(item.text);
      } else if (item.type === 'image_url') {
        // Rough estimate for image tokens - this varies by model and image size
        // A typical 512x512 image is roughly 85 tokens
        tokenCount += 85;
      }
    });
  }
  
  // Add per-message overhead (around 4 tokens per message)
  tokenCount += 4;
  
  return tokenCount;
};

/**
 * Count tokens for an array of messages
 * @param {Array} messages - Array of message objects
 * @returns {number} - Total number of tokens
 */
const countTokens = (messages) => {
  if (!messages || !Array.isArray(messages)) return 0;
  
  let totalTokens = 0;
  
  // Count tokens for each message
  messages.forEach(message => {
    totalTokens += countMessageTokens(message);
  });
  
  // Add request overhead (usually 3 tokens)
  totalTokens += 3;
  
  return totalTokens;
};

module.exports = {
  countTokens,
  countMessageTokens,
  countTokensForString
};