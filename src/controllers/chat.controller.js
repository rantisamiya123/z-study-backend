const httpStatus = require('http-status');
const chatService = require('../services/chat.service');
const conversationService = require('../services/conversation.service');
const openrouterService = require('../services/openrouter.service');
const userService = require('../services/user.service');
const settingService = require('../services/setting.service');
const fileService = require('../services/file.service');
const catchAsync = require('../utils/catchAsync.util');
const ApiError = require('../utils/error.util');
const tokenCounter = require('../utils/tokenCounter.util');
const { contextBuilder } = require('../utils/contextBuilder.util');
/**
 * Get chat history for a conversation
 */
const getConversationChats = catchAsync(async (req, res) => {
    const {
        conversationId
    } = req.params;
    const {
        userId
    } = req.user;
    const options = req.query;

    const chats = await chatService.getConversationChats(conversationId, userId, options);
    res.status(httpStatus.OK).send(chats);
});

/**
 * Get a chat by ID
 */
const getChatById = catchAsync(async (req, res) => {
    const {
        chatId
    } = req.params;
    const {
        userId
    } = req.user;

    const chat = await chatService.getChatById(chatId, userId);
    res.status(httpStatus.OK).send(chat);
});

/**
 * Update a chat
 */
const updateChat = catchAsync(async (req, res) => {
    const {
        chatId
    } = req.params;
    const {
        userId
    } = req.user;
    const updateData = req.body;

    const chat = await chatService.updateChat(chatId, updateData, userId);
    res.status(httpStatus.OK).send(chat);
});

/**
 * Delete a chat
 */
const deleteChat = catchAsync(async (req, res) => {
    const {
        chatId
    } = req.params;
    const {
        userId
    } = req.user;

    await chatService.deleteChat(chatId, userId);
    res.status(httpStatus.NO_CONTENT).send();
});

// chat.controller
/**
 * Create a chat completion
 */
const chatCompletion = catchAsync(async (req, res) => {
    const {
        model,
        messages,
        max_tokens,
        conversationId
    } = req.body;
    const { userId } = req.user;

    try {
        // Check user balance
        const user = await userService.getUserById(userId);

        // Get model details
        const models = await openrouterService.fetchModels();
        const selectedModel = models.find(m => m.id === model);
        if (!selectedModel) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid model selected');
        }

        // Find or create conversation
        const conversation = await conversationService.findOrCreateConversation(userId, conversationId);

        // Retrieve conversation history and build context-aware messages
        const contextEnrichedMessages = await contextBuilder.buildMessagesWithContext({
            userId,
            conversationId: conversation.conversationId,
            currentMessages: messages,
            model: selectedModel,
            maxContextTokens: selectedModel.contextWindow || 4096,
            reserveTokens: max_tokens || 1000
        });

        // Estimate tokens and cost with the enhanced context
        const estimatedPromptTokens = tokenCounter.countTokens(contextEnrichedMessages);
        const estimatedOutputTokens = max_tokens || Math.min(1000, selectedModel.contextWindow * 0.2);

        // Calculate estimated cost
        const exchangeRate = await settingService.getExchangeRate();
        const estimatedInputCostUSD = (estimatedPromptTokens / 1000) * selectedModel.inputPricePer1000Tokens;
        const estimatedOutputCostUSD = (estimatedOutputTokens / 1000) * selectedModel.outputPricePer1000Tokens;
        const estimatedTotalCostUSD = estimatedInputCostUSD + estimatedOutputCostUSD;
        const estimatedTotalCostIDR = estimatedTotalCostUSD * exchangeRate;

        // Check if user has sufficient balance
        if (user.balance < estimatedTotalCostIDR) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Insufficient balance for this operation');
        }

        // Create chat completion (non-streaming)
        const result = await openrouterService.createChatCompletion(
            userId, 
            model, 
            contextEnrichedMessages, 
            { max_tokens }
        );

        // Calculate final cost based on actual usage
        const { usage, model: modelDetails } = result;
        const {
            prompt_tokens,
            completion_tokens,
            total_tokens
        } = usage;
        
        // Use the model details returned from service for accurate pricing
        const inputCostUSD = (prompt_tokens / 1000) * modelDetails.pricing.prompt;
        const outputCostUSD = (completion_tokens / 1000) * modelDetails.pricing.completion;
        const totalCostUSD = inputCostUSD + outputCostUSD;
        const totalCostIDR = totalCostUSD * exchangeRate;

        // Deduct from user balance
        await userService.updateBalance(userId, -totalCostIDR);

        // Record the chat
        await chatService.recordChatUsage({
            userId,
            conversationId: conversation.conversationId,
            model,
            promptTokens: prompt_tokens,
            completionTokens: completion_tokens,
            totalTokens: total_tokens,
            costUSD: totalCostUSD,
            costIDR: totalCostIDR,
            content: {
                prompt: messages, // Store original user message without context for clarity
                response: result.message.content
            }
        });

        // Send response
        res.status(httpStatus.OK).json({
            success: true,
            data: {
                id: result.id,
                message: result.message,
                conversation: {
                    _id: conversation.conversationId,
                    title: conversation.title
                },
                usage,
                cost: {
                    usd: totalCostUSD,
                    idr: totalCostIDR
                }
            }
        });

    } catch (error) {
        console.error('Chat completion error:', error);
        
        if (error instanceof ApiError) {
            throw error;
        }
        
        throw new ApiError(
            httpStatus.INTERNAL_SERVER_ERROR, 
            error.message || 'An error occurred during chat completion'
        );
    }
});


// chat.controller.js
/**
 * Create a chat completion (stream)
 */
const chatCompletionStream = catchAsync(async (req, res) => {
    const {
        model,
        messages, // This will be the new format with chatHistory
        max_tokens,
        conversationId,
        chatHistory = [] // New: Frontend sends complete chat history
    } = req.body;
    const { userId } = req.user;

    // Headers for SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Transfer-Encoding': 'chunked',
        'X-Accel-Buffering': 'no'
    });

    let stream;

    try {
        // Check user balance
        const user = await userService.getUserById(userId);

        // Get model details
        const models = await openrouterService.fetchModels();
        const selectedModel = models.find(m => m.id === model);
        if (!selectedModel) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid model selected');
        }

        // Find or create conversation
        const conversation = await conversationService.findOrCreateConversation(
            userId, 
            conversationId, 
            messages
        );

        // NEW: Apply token optimization to chatHistory
        const tokenOptimizer = require('../services/tokenOptimizer.service');
        const optimizedChatHistory = await tokenOptimizer.optimizeChatHistory({
            chatHistory,
            model: selectedModel,
            maxContextTokens: selectedModel.contextWindow || 4096,
            reserveTokens: max_tokens || 1000
        });

        // Build context-aware messages using optimized history
        const contextEnrichedMessages = await contextBuilder.buildMessagesWithOptimizedHistory({
            userId,
            conversationId: conversation.conversationId,
            currentMessages: messages,
            optimizedHistory: optimizedChatHistory,
            model: selectedModel,
            maxContextTokens: selectedModel.contextWindow || 4096,
            reserveTokens: max_tokens || 1000
        });

        // Estimate tokens and cost
        const estimatedPromptTokens = tokenCounter.countTokens(contextEnrichedMessages);
        const estimatedOutputTokens = max_tokens || Math.min(1000, selectedModel.contextWindow * 0.2);

        // Calculate estimated cost
        const exchangeRate = await settingService.getExchangeRate();
        const estimatedInputCostUSD = (estimatedPromptTokens / 1000) * selectedModel.inputPricePer1000Tokens;
        const estimatedOutputCostUSD = (estimatedOutputTokens / 1000) * selectedModel.outputPricePer1000Tokens;
        const estimatedTotalCostUSD = estimatedInputCostUSD + estimatedOutputCostUSD;
        const estimatedTotalCostIDR = estimatedTotalCostUSD * exchangeRate;

        // Check balance
        if (user.balance < estimatedTotalCostIDR) {
            res.write(`data: ${JSON.stringify({ error: 'Insufficient balance for this operation' })}\n\n`);
            return res.end();
        }

        // Start the stream
        const { stream: responseStream } = await openrouterService.createChatCompletionStream(
            userId, 
            model, 
            contextEnrichedMessages, 
            { max_tokens }
        );
        
        stream = responseStream;
        let responseText = '';
        let usage = null;

        stream.on('data', (chunk) => {
            const data = chunk.toString();
            const lines = data.split('\n').filter(line => line.trim().startsWith('data:'));

            for (let line of lines) {
                let dataSliced = line.trim().slice(5).trim();

                while (dataSliced.startsWith('data:')) {
                    dataSliced = dataSliced.slice(5).trim();
                }

                try {
                    const parsedData = JSON.parse(dataSliced);

                    if (parsedData.usage) {
                        usage = parsedData.usage;
                    }

                    if (parsedData.choices && parsedData.choices[0].delta && parsedData.choices[0].delta.content) {
                        responseText += parsedData.choices[0].delta.content;
                    }

                    res.write(`data: ${JSON.stringify(parsedData)}\n\n`);
                } catch (err) {
                    console.error('JSON parse error:', err.message, dataSliced);
                }
            }

            if (res.flush) res.flush();
        });

        stream.on('end', async () => {
            res.write('data: [DONE]\n\n');

            try {
                if (usage) {
                    const {
                        prompt_tokens,
                        completion_tokens,
                        total_tokens
                    } = usage;

                    const inputCostUSD = (prompt_tokens / 1000) * selectedModel.pricing.prompt;
                    const outputCostUSD = (completion_tokens / 1000) * selectedModel.pricing.completion;
                    const totalCostUSD = inputCostUSD + outputCostUSD;
                    const totalCostIDR = totalCostUSD * exchangeRate;

                    // Deduct from user balance
                    await userService.updateBalance(userId, -totalCostIDR);

                    // NEW: Process chat history updates and save new chat
                    const { processChatHistoryUpdates } = require('../services/chat.service');
                    const chatResults = await processChatHistoryUpdates({
                        userId,
                        conversationId: conversation.conversationId,
                        chatHistory,
                        newUserMessage: messages[messages.length - 1], // Last message should be user's new message
                        assistantResponse: responseText,
                        model,
                        usage: {
                            promptTokens: prompt_tokens,
                            completionTokens: completion_tokens,
                            totalTokens: total_tokens,
                            costUSD: totalCostUSD,
                            costIDR: totalCostIDR
                        }
                    });

                    res.write(`data: ${JSON.stringify({ 
                        conversation: { 
                            conversationId: conversation.conversationId, 
                            title: conversation.title 
                        }, 
                        usage, 
                        cost: { 
                            usd: totalCostUSD, 
                            idr: totalCostIDR 
                        },
                        newChats: {
                            userChat: chatResults.userChat,
                            assistantChat: chatResults.assistantChat
                        },
                        optimizationInfo: {
                            originalHistoryLength: chatHistory.length,
                            optimizedHistoryLength: optimizedChatHistory.length,
                            tokensSaved: tokenCounter.countTokens(chatHistory.map(c => ({role: c.role, content: c.content}))) - tokenCounter.countTokens(optimizedChatHistory.map(c => ({role: c.role, content: c.content}))),
                            updatedChatsCount: chatResults.updatedChats
                        }
                    })}\n\n`);
                }
            } catch (error) {
                console.error('Error saving chat:', error);
                res.write(`data: ${JSON.stringify({ error: 'Error saving chat results' })}\n\n`);
            }

            res.end();
        });

        stream.on('error', (error) => {
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        });

        req.on('close', () => {
            if (stream) stream.destroy();
        });

    } catch (error) {
        console.error('Stream error:', error);
        if (stream) stream.destroy();

        if (error.message === 'Balance depleted during streaming') {  
            res.write(`data: ${JSON.stringify({ error: 'Balance depleted during streaming. Response truncated.' })}\n\n`);
        } else {
            res.write(`data: ${JSON.stringify({ error: error.message || 'An error occurred during streaming' })}\n\n`);
        }
        res.end();
    }
});

/**
 * Process file with chat completion (stream)
 */
const processFileStream = catchAsync(async (req, res) => {
    const {
        fileId,
        model,
        prompt,
        max_tokens,
        conversationId
    } = req.body;
    const {
        userId
    } = req.user;

    // Headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        // Get file details
        const file = await fileService.getFileById(fileId, userId);
        if (!file) {
            throw new ApiError(httpStatus.NOT_FOUND, 'File not found');
        }

        // Check user balance
        const user = await userService.getUserById(userId);

        // Find or create conversation
        const conversation = await conversationService.findOrCreateConversation(userId, conversationId);

        // Create appropriate messages based on file type
        let messages = [];
        if (file.fileType === 'image') {
            messages = [{
                    role: 'system',
                    content: 'You are an AI assistant that helps analyze images.'
                },
                {
                    role: 'user',
                    content: [{
                            type: 'image_url',
                            image_url: {
                                url: file.fileUrl
                            }
                        },
                        {
                            type: 'text',
                            text: prompt
                        }
                    ]
                }
            ];
        } else {
            messages = [{
                    role: 'system',
                    content: 'You are an AI assistant that helps analyze documents.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ];
        }

        // Estimate tokens and cost
        const models = await openrouterService.fetchModels();
        const selectedModel = models.find(m => m.id === model);
        if (!selectedModel) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid model selected');
        }

        // For image models, we use a fixed token estimate
        let estimatedPromptTokens = 0;
        if (file.fileType === 'image') {
            // Rough estimate for image tokens (varies by image size)
            estimatedPromptTokens = 100 + tokenCounter.countTokensForString(prompt);
        } else {
            estimatedPromptTokens = tokenCounter.countTokens(messages);
        }

        const estimatedOutputTokens = estimatedPromptTokens * 2;

        // Calculate estimated cost
        const exchangeRate = await settingService.getExchangeRate();
        const estimatedInputCostUSD = (estimatedPromptTokens / 1000) * selectedModel.inputPricePer1000Tokens;
        const estimatedOutputCostUSD = (estimatedOutputTokens / 1000) * selectedModel.outputPricePer1000Tokens;
        const estimatedTotalCostUSD = estimatedInputCostUSD + estimatedOutputCostUSD;
        const estimatedTotalCostIDR = estimatedTotalCostUSD * exchangeRate;

        // Check if user has sufficient balance
        if (user.balance < estimatedTotalCostIDR) {
            res.write(`event: error\ndata: ${JSON.stringify({ message: 'Insufficient balance for this operation' })}\n\n`);
            return res.end();
        }

        // Start streaming
        const {
            stream
        } = await openrouterService.createChatCompletionStream(
            userId, model, messages, {
                max_tokens
            }
        );

        let responseText = '';
        let usage = null;

        // Process stream data
        stream.on('data', (chunk) => {
            const data = chunk.toString();

            try {
                if (data.includes('[DONE]')) {
                    res.write(`event: done\ndata: [DONE]\n\n`);
                    return;
                }

                const parsedData = JSON.parse(data);

                // If we have usage info, capture it
                if (parsedData.usage) {
                    usage = parsedData.usage;
                }

                // Collect response text
                if (parsedData.choices && parsedData.choices[0].delta && parsedData.choices[0].delta.content) {
                    responseText += parsedData.choices[0].delta.content;
                }

                // Check balance during streaming
                if (responseText.length % 100 === 0) {
                    // Re-estimate cost based on current response length
                    const currentOutputTokens = tokenCounter.countTokensForString(responseText);
                    const currentOutputCostUSD = (currentOutputTokens / 1000) * selectedModel.outputPricePer1000Tokens;
                    const currentTotalCostUSD = estimatedInputCostUSD + currentOutputCostUSD;
                    const currentTotalCostIDR = currentTotalCostUSD * exchangeRate;

                    // If cost exceeds balance, stop the stream
                    if (currentTotalCostIDR > user.balance) {
                        throw new Error('Balance depleted during streaming');
                    }
                }

                // Forward to client
                res.write(`data: ${data}\n\n`);
            } catch (error) {
                // Stop streaming if an error occurs
                stream.destroy();

                if (error.message === 'Balance depleted during streaming') {
                    res.write(`event: error\ndata: ${JSON.stringify({ message: 'Balance depleted during streaming. Response truncated.' })}\n\n`);
                    res.end();
                }
            }
        });

        // When stream ends, save the chat
        stream.on('end', async () => {
            try {
                if (usage) {
                    // Calculate final cost
                    const {
                        prompt_tokens,
                        completion_tokens,
                        total_tokens
                    } = usage;
                    const inputCostUSD = (prompt_tokens / 1000) * selectedModel.inputPricePer1000Tokens;
                    const outputCostUSD = (completion_tokens / 1000) * selectedModel.outputPricePer1000Tokens;
                    const totalCostUSD = inputCostUSD + outputCostUSD;
                    const totalCostIDR = totalCostUSD * exchangeRate;

                    // Deduct from user balance
                    await userService.updateBalance(userId, -totalCostIDR);

                    // Record the chat
                    await chatService.recordChatUsage({
                        userId,
                        conversationId: conversation.conversationId,
                        model,
                        promptTokens: prompt_tokens,
                        completionTokens: completion_tokens,
                        totalTokens: total_tokens,
                        costUSD: totalCostUSD,
                        costIDR: totalCostIDR,
                        content: {
                            prompt,
                            response: responseText
                        },
                        filesUrl: [file.fileUrl]
                    });

                    // Send final usage info
                    res.write(`event: usage\ndata: ${JSON.stringify({ 
            usage, 
            cost: { usd: totalCostUSD, idr: totalCostIDR } 
          })}\n\n`);
                }

                res.end();
            } catch (error) {
                console.error('Error saving chat:', error);
                res.write(`event: error\ndata: ${JSON.stringify({ message: 'Error saving chat results' })}\n\n`);
                res.end();
            }
        });

        // Handle errors
        stream.on('error', (error) => {
            console.error('Stream error:', error);
            res.write(`event: error\ndata: ${JSON.stringify({ message: 'Error during streaming' })}\n\n`);
            res.end();
        });

        // Handle client disconnect
        req.on('close', () => {
            stream.destroy();
        });
    } catch (error) {
        console.error('File processing error:', error);
        res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
        res.end();
    }
});

/**
 * Retry a chat with the same prompt
 */
const retryChat = catchAsync(async (req, res) => {
    const {
        chatId
    } = req.params;
    const {
        userId
    } = req.user;

    // Get the original chat
    const chat = await chatService.getChatById(chatId, userId);

    // Extract the original prompt
    const prompt = chat.content.prompt;

    // Call the streaming endpoint with the same prompt
    req.body = {
        model: chat.model,
        messages: prompt,
        conversationId: chat.conversationId
    };

    // Forward to the streaming handler
    return chatCompletionStream(req, res);
});

module.exports = {
    getConversationChats,
    getChatById,
    updateChat,
    deleteChat,
    chatCompletionStream,
    processFileStream,
    retryChat,
    chatCompletion
};