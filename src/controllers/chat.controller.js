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
    const { conversationId } = req.params;
    const { userId } = req.user;
    const options = req.query;

    const chats = await chatService.getConversationChats(conversationId, userId, options);
    res.status(httpStatus.OK).send(chats);
});

/**
 * Get a chat by ID
 */
const getChatById = catchAsync(async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.user;

    const chat = await chatService.getChatById(chatId, userId);
    res.status(httpStatus.OK).send(chat);
});

/**
 * Update a chat
 */
const updateChat = catchAsync(async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.user;
    const updateData = req.body;

    const chat = await chatService.updateChat(chatId, updateData, userId);
    res.status(httpStatus.OK).send(chat);
});

/**
 * Edit a user message and regenerate assistant response
 */
const editMessage = catchAsync(async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.user;
    const { content, model } = req.body;

    if (!content) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Content is required');
    }

    if (!model) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Model is required');
    }

    const result = await chatService.editMessageAndRegenerate(chatId, content, userId, model);
    
    res.status(httpStatus.OK).send({
        success: true,
        data: result
    });
});

/**
 * Switch to a specific version of a chat
 */
const switchToVersion = catchAsync(async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.user;
    const { versionNumber } = req.body;

    if (!versionNumber || typeof versionNumber !== 'number') {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Version number is required and must be a number');
    }

    const result = await chatService.switchToVersion(chatId, versionNumber, userId);
    
    res.status(httpStatus.OK).send({
        success: true,
        data: result
    });
});

/**
 * Get all versions of a specific chat
 */
const getChatVersions = catchAsync(async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.user;

    const versions = await chatService.getChatVersions(chatId, userId);
    
    res.status(httpStatus.OK).send({
        success: true,
        data: {
            versions
        }
    });
});

/**
 * Regenerate assistant response
 */
const regenerateResponse = catchAsync(async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.user;
    const { model } = req.body;

    if (!model) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Model is required');
    }

    const result = await chatService.regenerateAssistantResponse(chatId, userId, model);
    
    res.status(httpStatus.OK).send({
        success: true,
        data: result
    });
});

/**
 * Delete a chat
 */
const deleteChat = catchAsync(async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.user;

    await chatService.deleteChat(chatId, userId);
    res.status(httpStatus.NO_CONTENT).send();
});

/**
 * Create a chat completion
 */
const chatCompletion = catchAsync(async (req, res) => {
    const { model, messages, max_tokens, conversationId } = req.body;
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

        // Get active conversation history for context
        const conversationHistory = await chatService.getActiveConversationHistory(
            conversation.conversationId,
            999999 // Get all history
        );

        // Build context-aware messages
        const contextMessages = conversationHistory.map(chat => ({
            role: chat.role,
            content: chat.content
        }));

        // Add current user message
        const userMessage = messages[messages.length - 1];
        contextMessages.push(userMessage);

        // Estimate tokens and cost
        const estimatedPromptTokens = tokenCounter.countTokens(contextMessages);
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

        // Create chat completion
        const result = await openrouterService.createChatCompletion(
            userId, 
            model, 
            contextMessages, 
            { max_tokens }
        );

        // Calculate final cost based on actual usage
        const { usage, model: modelDetails } = result;
        const { prompt_tokens, completion_tokens, total_tokens } = usage;
        
        const inputCostUSD = (prompt_tokens / 1000) * modelDetails.pricing.prompt;
        const outputCostUSD = (completion_tokens / 1000) * modelDetails.pricing.completion;
        const totalCostUSD = inputCostUSD + outputCostUSD;
        const totalCostIDR = totalCostUSD * exchangeRate;

        // Deduct from user balance
        await userService.updateBalance(userId, -totalCostIDR);

        // Create chat pair (user message + assistant response)
        const chatPair = await chatService.createChatPair({
            conversationId: conversation.conversationId,
            userId,
            model,
            userContent: userMessage.content,
            assistantContent: result.message.content,
            usage: {
                promptTokens: prompt_tokens,
                completionTokens: completion_tokens,
                totalTokens: total_tokens,
                costUSD: totalCostUSD,
                costIDR: totalCostIDR
            }
        });

        // Send response
        res.status(httpStatus.OK).json({
            success: true,
            data: {
                id: result.id,
                userMessage: chatPair.userChat,
                assistantMessage: chatPair.assistantChat,
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

/**
 * Create a chat completion (stream)
 */
const chatCompletionStream = catchAsync(async (req, res) => {
    const { model, messages, max_tokens, conversationId } = req.body;
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

        // Get active conversation history for context
        const conversationHistory = await chatService.getActiveConversationHistory(
            conversation.conversationId,
            999999 // Get all history
        );

        // Build context-aware messages
        const contextMessages = conversationHistory.map(chat => ({
            role: chat.role,
            content: chat.content
        }));

        // Add current user message
        const userMessage = messages[messages.length - 1];
        contextMessages.push(userMessage);

        // Estimate tokens and cost
        const estimatedPromptTokens = tokenCounter.countTokens(contextMessages);
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
            contextMessages, 
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
                    const { prompt_tokens, completion_tokens, total_tokens } = usage;

                    const inputCostUSD = (prompt_tokens / 1000) * selectedModel.pricing.prompt;
                    const outputCostUSD = (completion_tokens / 1000) * selectedModel.pricing.completion;
                    const totalCostUSD = inputCostUSD + outputCostUSD;
                    const totalCostIDR = totalCostUSD * exchangeRate;

                    // Deduct from user balance
                    await userService.updateBalance(userId, -totalCostIDR);

                    // Create chat pair (user message + assistant response)
                    const chatPair = await chatService.createChatPair({
                        conversationId: conversation.conversationId,
                        userId,
                        model,
                        userContent: userMessage.content,
                        assistantContent: responseText,
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
                        userMessage: chatPair.userChat,
                        assistantMessage: chatPair.assistantChat
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
    const { fileId, model, prompt, max_tokens, conversationId } = req.body;
    const { userId } = req.user;

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
        const { stream } = await openrouterService.createChatCompletionStream(
            userId, model, messages, { max_tokens }
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
                    const currentOutputTokens = tokenCounter.countTokensForString(responseText);
                    const currentOutputCostUSD = (currentOutputTokens / 1000) * selectedModel.outputPricePer1000Tokens;
                    const currentTotalCostUSD = estimatedInputCostUSD + currentOutputCostUSD;
                    const currentTotalCostIDR = currentTotalCostUSD * exchangeRate;

                    if (currentTotalCostIDR > user.balance) {
                        throw new Error('Balance depleted during streaming');
                    }
                }

                // Forward to client
                res.write(`data: ${data}\n\n`);
            } catch (error) {
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
                    const { prompt_tokens, completion_tokens, total_tokens } = usage;
                    const inputCostUSD = (prompt_tokens / 1000) * selectedModel.inputPricePer1000Tokens;
                    const outputCostUSD = (completion_tokens / 1000) * selectedModel.outputPricePer1000Tokens;
                    const totalCostUSD = inputCostUSD + outputCostUSD;
                    const totalCostIDR = totalCostUSD * exchangeRate;

                    // Deduct from user balance
                    await userService.updateBalance(userId, -totalCostIDR);

                    // Create chat pair for file processing
                    const chatPair = await chatService.createChatPair({
                        conversationId: conversation.conversationId,
                        userId,
                        model,
                        userContent: prompt,
                        assistantContent: responseText,
                        filesUrl: [file.fileUrl],
                        usage: {
                            promptTokens: prompt_tokens,
                            completionTokens: completion_tokens,
                            totalTokens: total_tokens,
                            costUSD: totalCostUSD,
                            costIDR: totalCostIDR
                        }
                    });

                    // Send final usage info
                    res.write(`event: usage\ndata: ${JSON.stringify({ 
                        usage, 
                        cost: { usd: totalCostUSD, idr: totalCostIDR },
                        userMessage: chatPair.userChat,
                        assistantMessage: chatPair.assistantChat
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
    const { chatId } = req.params;
    const { userId } = req.user;
    const { model } = req.body;

    if (!model) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Model is required');
    }

    // Get the original chat
    const chat = await chatService.getChatById(chatId, userId);

    if (chat.role === 'assistant') {
        // If it's an assistant message, regenerate it
        const result = await chatService.regenerateAssistantResponse(chatId, userId, model);
        return res.status(httpStatus.OK).send({
            success: true,
            data: result
        });
    } else if (chat.role === 'user') {
        // If it's a user message, regenerate the assistant response
        // Find the assistant response that follows this user message
        const conversationChats = await chatService.getConversationChats(
            chat.conversationId, 
            userId, 
            { activeOnly: true, currentVersionOnly: true }
        );
        
        const assistantChat = conversationChats.results.find(c => 
            c.parentChatId === chat.chatId && c.role === 'assistant'
        );
        
        if (assistantChat) {
            const result = await chatService.regenerateAssistantResponse(assistantChat.chatId, userId, model);
            return res.status(httpStatus.OK).send({
                success: true,
                data: result
            });
        } else {
            throw new ApiError(httpStatus.NOT_FOUND, 'No assistant response found to regenerate');
        }
    } else {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid chat type for retry');
    }
});

module.exports = {
    getConversationChats,
    getChatById,
    updateChat,
    editMessage,
    switchToVersion,
    getChatVersions,
    regenerateResponse,
    deleteChat,
    chatCompletionStream,
    processFileStream,
    retryChat,
    chatCompletion
};