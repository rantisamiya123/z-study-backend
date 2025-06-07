const chatService = require('../services/chat.service');
const tokenCounter = require('./tokenCounter.util');

const contextBuilder = {
  /**
   * Build messages with conversation history context
   * @param {Object} options - Context building options
   * @returns {Promise<Array>} - Messages array with context
   */
  buildMessagesWithContext: async function({
    userId,
    conversationId,
    currentMessages,
    model,
    maxContextTokens = 4096,
    reserveTokens = 1000
  }) {
    // If no conversation ID, just return the current messages
    if (!conversationId) return currentMessages;
    
    // If current messages are empty, return empty array
    if (!currentMessages || !currentMessages.length) return [];
    
    // Calculate available token budget
    const availableContextTokens = maxContextTokens - reserveTokens;
    const currentMessagesTokens = tokenCounter.countTokens(currentMessages);
    const remainingTokens = Math.max(0, availableContextTokens - currentMessagesTokens);
    
    // If no tokens left for history, just return current messages
    if (remainingTokens <= 0) return currentMessages;
    
    // Retrieve conversation history
    const recentChats = await chatService.getRecentChats(conversationId, 50); // Get up to 50 recent messages
    
    if (!recentChats || recentChats.length === 0) {
      return currentMessages; // No history available
    }
    
    // Convert chat history to message format
    const historyMessages = [];
    
    // Process from oldest to newest
    for (const chat of recentChats) {
      if (chat.content && chat.content.prompt) {
        // Add user message from history
        if (Array.isArray(chat.content.prompt)) {
          // If prompt is already an array, get the last user message
          const lastUserMessage = chat.content.prompt[chat.content.prompt.length - 1];
          if (lastUserMessage && lastUserMessage.role === 'user') {
            historyMessages.push(lastUserMessage);
          }
        } else if (typeof chat.content.prompt === 'string') {
          // Handle case where prompt is a string
          historyMessages.push({
            role: 'user',
            content: chat.content.prompt
          });
        }
      }
      
      // Add assistant response from history
      if (chat.content && chat.content.response) {
        historyMessages.push({
          role: 'assistant',
          content: chat.content.response
        });
      }
    }
    
    // Add system message at the beginning if not present
    const hasSystemMessage = currentMessages.some(msg => msg.role === 'system');
    
    // Prepare the final messages array
    let finalMessages = [];
    
    if (hasSystemMessage) {
      // If current messages have a system message, keep it at the beginning
      const systemMessage = currentMessages.find(msg => msg.role === 'system');
      const nonSystemMessages = currentMessages.filter(msg => msg.role !== 'system');
      finalMessages = [systemMessage, ...this._fitHistoryInTokenBudget(historyMessages, remainingTokens), ...nonSystemMessages];
    } else {
      // If no system message, create one summarizing the conversation
      const systemMessage = {
        role: 'system',
        content: 'This is a continuation of a previous conversation. Use the conversation history to maintain context.'
      };
      
      finalMessages = [systemMessage, ...this._fitHistoryInTokenBudget(historyMessages, remainingTokens - tokenCounter.countTokens([systemMessage])), ...currentMessages];
    }
    
    return finalMessages;
  },
  
  /**
   * Fit history messages within token budget
   * @param {Array} historyMessages - History messages array
   * @param {number} tokenBudget - Available token budget
   * @returns {Array} - Fitted history messages
   */
  _fitHistoryInTokenBudget: function(historyMessages, tokenBudget) {
    if (!historyMessages.length) return [];
    
    // If all history fits within budget, return all
    const totalHistoryTokens = tokenCounter.countTokens(historyMessages);
    if (totalHistoryTokens <= tokenBudget) {
      return historyMessages;
    }
    
    // Start with most recent messages (prioritize recent context)
    const fittedMessages = [];
    let usedTokens = 0;
    
    // Process from newest to oldest
    for (let i = historyMessages.length - 1; i >= 0; i--) {
      const message = historyMessages[i];
      const messageTokens = tokenCounter.countTokens([message]);
      
      // If adding this message would exceed budget, stop
      if (usedTokens + messageTokens > tokenBudget) {
        break;
      }
      
      // Add message to the beginning (to maintain chronological order)
      fittedMessages.unshift(message);
      usedTokens += messageTokens;
    }
    
    // If we included at least one message but have significant budget left,
    // add a summary of the earliest messages
    const remainingBudget = tokenBudget - usedTokens;
    if (fittedMessages.length > 0 && fittedMessages.length < historyMessages.length && remainingBudget > 100) {
      const omittedCount = historyMessages.length - fittedMessages.length;
      
      // Create a summary message
      const summaryMessage = {
        role: 'system',
        content: `[Context: ${omittedCount} earlier messages omitted for brevity. The conversation continues from here.]`
      };
      
      // Only add if it fits in the budget
      if (tokenCounter.countTokens([summaryMessage]) <= remainingBudget) {
        fittedMessages.unshift(summaryMessage);
      }
    }
    
    return fittedMessages;
  },
   /**
   * Build messages with optimized history from frontend
   * @param {Object} params - Build parameters
   * @returns {Array} - Context-enriched messages
   */
  buildMessagesWithOptimizedHistory: async function({
    userId,
    conversationId,
    currentMessages,
    optimizedHistory,
    model,
    maxContextTokens = 4096,
    reserveTokens = 1000
  }) {
    try {
      // If no optimized history, just return current messages
      if (!optimizedHistory || optimizedHistory.length === 0) {
        return currentMessages;
      }

      // Calculate available token budget
      const availableContextTokens = maxContextTokens - reserveTokens;
      const currentMessagesTokens = tokenCounter.countTokens(currentMessages);
      const remainingTokens = Math.max(0, availableContextTokens - currentMessagesTokens);

      // If no tokens left for history, just return current messages  
      if (remainingTokens <= 0) {
        return currentMessages;
      }

      // Convert optimized history to OpenAI message format
      const historyMessages = optimizedHistory.map(chat => ({
        role: chat.role,
        content: chat.content
      }));

      // Fit history within remaining token budget
      const fittedHistory = this._fitHistoryInTokenBudget(historyMessages, remainingTokens);

      // Check if current messages have system message
      const hasSystemMessage = currentMessages.some(msg => msg.role === 'system');
      
      // Prepare final messages array
      let finalMessages = [];
      
      if (hasSystemMessage) {
        // Keep existing system message at the beginning
        const systemMessage = currentMessages.find(msg => msg.role === 'system');
        const nonSystemMessages = currentMessages.filter(msg => msg.role !== 'system');
        finalMessages = [systemMessage, ...fittedHistory, ...nonSystemMessages];
      } else {
        // Add default system message for context continuity
        const systemMessage = {
          role: 'system',
          content: 'This is a continuation of a previous conversation. Use the conversation history to maintain context and consistency with previous responses.'
        };
        
        finalMessages = [systemMessage, ...fittedHistory, ...currentMessages];
      }

      return finalMessages;

    } catch (error) {
      console.error('Error building messages with optimized history:', error);
      // Fallback to current messages only
      return currentMessages;
    }
  },
};

module.exports = {
  contextBuilder
};