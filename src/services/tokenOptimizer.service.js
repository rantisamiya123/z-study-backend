const tokenCounter = require('../utils/tokenCounter.util');

class TokenOptimizer {
    /**
     * Optimize chat history to reduce token usage while maintaining context
     * @param {Object} params - Optimization parameters
     * @param {Array} params.chatHistory - Array of chat messages with updated flags
     * @param {Object} params.model - Model information
     * @param {number} params.maxContextTokens - Maximum context window
     * @param {number} params.reserveTokens - Tokens to reserve for response  
     * @returns {Array} - Optimized chat history
     */
    async optimizeChatHistory({ chatHistory, model, maxContextTokens, reserveTokens }) {
        if (!chatHistory || chatHistory.length === 0) {
            return [];
        }

        const availableTokens = maxContextTokens - reserveTokens;
        let optimizedHistory = [...chatHistory];
        
        // Strategy 1: Remove non-updated messages from the middle (keep recent and updated)
        optimizedHistory = this.removeMiddleNonUpdated(optimizedHistory, availableTokens);
        
        // Strategy 2: If still too long, apply sliding window with priority to updated messages
        if (tokenCounter.countTokens(optimizedHistory) > availableTokens) {
            optimizedHistory = this.applySlidingWindowWithPriority(optimizedHistory, availableTokens);
        }
        
        // Strategy 3: If still too long, apply content truncation for very long messages
        if (tokenCounter.countTokens(optimizedHistory) > availableTokens) {
            optimizedHistory = this.truncateLongMessages(optimizedHistory, availableTokens);
        }

        return optimizedHistory;
    }

    /**
     * Remove non-updated messages from the middle part of conversation
     * Keep first few and last few messages, prioritize updated messages
     */
    removeMiddleNonUpdated(history, maxTokens) {
        if (tokenCounter.countTokens(history) <= maxTokens) {
            return history;
        }

        const keepStart = 4; // Keep first 4 messages for context
        const keepEnd = 6;   // Keep last 6 messages for recent context
        
        if (history.length <= keepStart + keepEnd) {
            return history;
        }

        const startMessages = history.slice(0, keepStart);
        const endMessages = history.slice(-keepEnd);
        const middleMessages = history.slice(keepStart, -keepEnd);
        
        // From middle, only keep updated messages
        const updatedMiddle = middleMessages.filter(msg => msg.updated === true);
        
        const result = [...startMessages, ...updatedMiddle, ...endMessages];
        
        // If still too long, remove some updated middle messages (oldest first)
        if (tokenCounter.countTokens(result) > maxTokens && updatedMiddle.length > 0) {
            const reducedUpdated = updatedMiddle.slice(-Math.floor(updatedMiddle.length / 2));
            return [...startMessages, ...reducedUpdated, ...endMessages];
        }
        
        return result;
    }

    /**
     * Apply sliding window but prioritize updated messages
     */
    applySlidingWindowWithPriority(history, maxTokens) {
        let currentTokens = tokenCounter.countTokens(history);
        let optimized = [...history];
        
        // Remove from the beginning, but skip updated messages if possible
        while (currentTokens > maxTokens && optimized.length > 2) {
            let removed = false;
            
            // Try to remove non-updated messages first
            for (let i = 1; i < optimized.length - 1; i++) {
                if (!optimized[i].updated) {
                    optimized.splice(i, 1);
                    currentTokens = tokenCounter.countTokens(optimized);
                    removed = true;
                    break;
                }
            }
            
            // If no non-updated messages to remove, remove from beginning
            if (!removed) {
                optimized.shift();
                currentTokens = tokenCounter.countTokens(optimized);
            }
        }
        
        return optimized;
    }

    /**
     * Truncate very long individual messages
     */
    truncateLongMessages(history, maxTokens) {
        const maxMessageTokens = 500; // Max tokens per message
        
        return history.map(msg => {
            const messageTokens = tokenCounter.countTokens([msg]);
            if (messageTokens > maxMessageTokens) {
                const truncatedContent = this.truncateContent(msg.content, maxMessageTokens);
                return {
                    ...msg,
                    content: truncatedContent + '... [truncated]'
                };
            }
            return msg;
        });
    }

    /**
     * Truncate content to fit within token limit
     */
    truncateContent(content, maxTokens) {
        const words = content.split(' ');
        const avgTokensPerWord = 1.3; // Rough estimate
        const maxWords = Math.floor(maxTokens / avgTokensPerWord);
        
        if (words.length <= maxWords) {
            return content;
        }
        
        return words.slice(0, maxWords).join(' ');
    }
}

module.exports = new TokenOptimizer();