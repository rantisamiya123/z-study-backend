const httpStatus = require('http-status');
const chatService = require('../services/chat.service');
const conversationService = require('../services/conversation.service');
const openrouterService = require('../services/openrouter.service');
const userService = require('../services/user.service');
const settingService = require('../services/setting.service');
const catchAsync = require('../utils/catchAsync.util');
const ApiError = require('../utils/error.util');
const tokenCounter = require('../utils/tokenCounter.util');

/**
 * Get chat history for a conversation with versioning information
 * GET /api/chat/conversation/:conversationId
 * 
 * Query Parameters:
 * - limit: Number of messages to return (default: 20)
 * - lastEvaluatedKey: For pagination
 * - sortOrder: 'asc' or 'desc' (default: 'asc')
 * - activeOnly: Show only active messages (default: true)
 * - currentVersionOnly: Show only current versions (default: true)
 * 
 * Response includes versioning information for each message
 */
const getConversationChats = catchAsync(async (req, res) => {
    const { conversationId } = req.params;
    const { userId } = req.user;
    const options = req.query;

    const chats = await chatService.getConversationChats(conversationId, userId, options);
    
    res.status(httpStatus.OK).send({
        success: true,
        data: chats
    });
});

/**
 * Get a specific chat by ID with full versioning details
 * GET /api/chat/:chatId
 */
const getChatById = catchAsync(async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.user;

    const chat = await chatService.getChatById(chatId, userId);
    
    res.status(httpStatus.OK).send({
        success: true,
        data: chat
    });
});

/**
 * Edit a user message content (creates new version)
 * PUT /api/chat/:chatId/edit
 * 
 * Body:
 * - content: New message content (required)
 * 
 * Logic:
 * 1. Only user messages can be edited
 * 2. Creates new version of the user message
 * 3. Does NOT regenerate assistant response automatically
 * 4. Marks subsequent messages as inactive (conversation branches here)
 * 5. Returns versioning information
 */
const editUserMessage = catchAsync(async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.user;
    const { content } = req.body;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Content is required and cannot be empty');
    }

    const result = await chatService.editUserMessage(chatId, content.trim(), userId);
    
    res.status(httpStatus.OK).send({
        success: true,
        message: 'Message edited successfully',
        data: result
    });
});

/**
 * Edit assistant response content (creates new version)
 * PUT /api/chat/:chatId/edit-response
 * 
 * Body:
 * - content: New response content (required)
 * 
 * Logic:
 * 1. Only assistant messages can be edited
 * 2. Creates new version of the assistant response
 * 3. Does NOT trigger any regeneration
 * 4. Updates versioning information
 */
const editAssistantResponse = catchAsync(async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.user;
    const { content } = req.body;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Content is required and cannot be empty');
    }

    const result = await chatService.editAssistantResponse(chatId, content.trim(), userId);
    
    res.status(httpStatus.OK).send({
        success: true,
        message: 'Response edited successfully',
        data: result
    });
});

/**
 * Generate new assistant response for a user message
 * POST /api/chat/:chatId/generate
 * 
 * Body:
 * - model: Model to use for generation (required)
 * 
 * Logic:
 * 1. Can only generate response for user messages
 * 2. Creates new assistant message or new version if one exists
 * 3. Uses streaming response
 * 4. Deducts cost from user balance
 */
const generateResponse = catchAsync(async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.user;
    const { model } = req.body;

    if (!model) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Model is required');
    }

    // Set headers for SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Transfer-Encoding': 'chunked',
        'X-Accel-Buffering': 'no'
    });

    let stream;

    try {
        const result = await chatService.generateResponseForUserMessage(chatId, userId, model, res);
        
        // The response is handled in the service through streaming
        // This endpoint doesn't return JSON, it streams the response
        
    } catch (error) {
        console.error('Generate response error:', error);
        if (stream) stream.destroy();

        res.write(`data: ${JSON.stringify({ 
            error: error.message || 'An error occurred during generation' 
        })}\n\n`);
        res.end();
    }
});

/**
 * Switch to a specific version of a chat
 * POST /api/chat/:chatId/switch-version
 * 
 * Body:
 * - versionNumber: Version number to switch to (required)
 * 
 * Logic:
 * 1. Switches the active version of a message
 * 2. Updates conversation timeline accordingly
 * 3. May affect subsequent messages in the conversation
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
        message: 'Successfully switched to version',
        data: result
    });
});

/**
 * Get all versions of a specific chat
 * GET /api/chat/:chatId/versions
 * 
 * Returns all versions of a message with metadata
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
 * Delete a chat message
 * DELETE /api/chat/:chatId
 * 
 * Logic:
 * 1. Soft delete - marks as inactive
 * 2. May affect conversation flow
 * 3. Preserves versioning history
 */
const deleteChat = catchAsync(async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.user;

    await chatService.deleteChat(chatId, userId);
    
    res.status(httpStatus.NO_CONTENT).send();
});

/**
 * Create new chat with streaming response
 * POST /api/chat/stream
 * 
 * Body:
 * - model: Model to use (required)
 * - messages: Array of messages (required)
 * - max_tokens: Maximum tokens for response (optional)
 * - conversationId: Existing conversation ID (optional)
 * 
 * Logic:
 * 1. Creates or finds conversation
 * 2. Validates user balance
 * 3. Streams response from LLM
 * 4. Creates chat pair (user + assistant)
 * 5. Deducts cost from balance
 */
const chatCompletionStream = catchAsync(async (req, res) => {
    const { model, messages, max_tokens, conversationId } = req.body;
    const { userId } = req.user;

    // Validate required fields
    if (!model) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Model is required');
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Messages array is required and cannot be empty');
    }

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
        const estimatedOutputTokens = max_tokens || Math.min(1000, selectedModel.context_length * 0.2);

        // Calculate estimated cost
        const exchangeRate = await settingService.getExchangeRate();
        const estimatedInputCostUSD = (estimatedPromptTokens / 1000) * selectedModel.pricing.prompt;
        const estimatedOutputCostUSD = (estimatedOutputTokens / 1000) * selectedModel.pricing.completion;
        const estimatedTotalCostUSD = estimatedInputCostUSD + estimatedOutputCostUSD;
        const estimatedTotalCostIDR = estimatedTotalCostUSD * exchangeRate;

        // Check balance
        if (user.balance < estimatedTotalCostIDR) {
            res.write(`data: ${JSON.stringify({ 
                error: 'Insufficient balance for this operation',
                required: estimatedTotalCostIDR,
                current: user.balance
            })}\n\n`);
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
 * POST /api/chat/process-file/stream
 * 
 * Body:
 * - fileId: File ID to process (required)
 * - model: Model to use (required)
 * - prompt: User prompt (required)
 * - max_tokens: Maximum tokens (optional)
 * - conversationId: Conversation ID (optional)
 */
const processFileStream = catchAsync(async (req, res) => {
    const { fileId, model, prompt, max_tokens, conversationId } = req.body;
    const { userId } = req.user;

    // Validate required fields
    if (!fileId) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'File ID is required');
    }
    if (!model) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Model is required');
    }
    if (!prompt) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Prompt is required');
    }

    // Headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        // Get file details
        const fileService = require('../services/file.service');
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
        const estimatedInputCostUSD = (estimatedPromptTokens / 1000) * selectedModel.pricing.prompt;
        const estimatedOutputCostUSD = (estimatedOutputTokens / 1000) * selectedModel.pricing.completion;
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
                    const currentOutputCostUSD = (currentOutputTokens / 1000) * selectedModel.pricing.completion;
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
                    const inputCostUSD = (prompt_tokens / 1000) * selectedModel.pricing.prompt;
                    const outputCostUSD = (completion_tokens / 1000) * selectedModel.pricing.completion;
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

module.exports = {
    getConversationChats,
    getChatById,
    editUserMessage,
    editAssistantResponse,
    generateResponse,
    switchToVersion,
    getChatVersions,
    deleteChat,
    chatCompletionStream,
    processFileStream
};