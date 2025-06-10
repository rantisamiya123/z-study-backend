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
 * Get chat history for a conversation with versioning information and lazy loading
 * GET /api/chat/conversation/:conversationId
 * 
 * Query Parameters:
 * - limit: Number of messages to return (default: 20, max: 100)
 * - lastEvaluatedKey: For pagination (base64 encoded)
 * - sortOrder: 'asc' or 'desc' (default: 'desc' for latest first)
 * - includeVersions: Include version metadata (default: false for performance)
 * 
 * Response includes only current versions for optimal performance
 */
const getConversationChats = catchAsync(async (req, res) => {
    const { conversationId } = req.params;
    const { userId } = req.user;
    const { 
        limit = 20, 
        lastEvaluatedKey = null, 
        sortOrder = 'desc',
        includeVersions = false 
    } = req.query;

    // Validate limit
    const sanitizedLimit = Math.min(Math.max(1, parseInt(limit)), 100);

    const options = {
        limit: sanitizedLimit,
        lastEvaluatedKey: lastEvaluatedKey ? JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString()) : null,
        sortOrder,
        activeOnly: true,
        currentVersionOnly: true // Always get current versions only for main chat history
    };

    const chats = await chatService.getConversationChats(conversationId, userId, options);
    
    // Encode lastEvaluatedKey for frontend
    const encodedLastKey = chats.data.lastEvaluatedKey 
        ? Buffer.from(JSON.stringify(chats.data.lastEvaluatedKey)).toString('base64')
        : null;

    // Enhance with version info only if requested
    let enhancedResults = chats.data.results;
    if (includeVersions === 'true') {
        enhancedResults = await Promise.all(
            chats.data.results.map(async (chat) => {
                const versions = await chatService.getChatVersions(chat.originalChatId || chat.chatId, userId);
                return {
                    ...chat,
                    hasMultipleVersions: versions.length > 1,
                    totalVersions: versions.length,
                    canEdit: chat.role === 'user' || chat.role === 'assistant'
                };
            })
        );
    } else {
        // Minimal version info for performance
        enhancedResults = chats.data.results.map(chat => ({
            ...chat,
            canEdit: chat.role === 'user' || chat.role === 'assistant'
        }));
    }

    res.status(httpStatus.OK).send({
        success: true,
        data: {
            results: enhancedResults,
            lastEvaluatedKey: encodedLastKey,
            hasMore: !!chats.data.lastEvaluatedKey,
            limit: sanitizedLimit,
            totalResults: chats.data.totalResults,
            conversationInfo: chats.data.conversationInfo
        }
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
 * Edit user message and auto-generate new response with streaming
 * PUT /api/chat/:chatId/edit-and-complete
 * 
 * Body:
 * - content: New message content (required)
 * - model: Model to use for new completion (required)
 * - autoComplete: Whether to auto-generate response (default: true)
 * 
 * This endpoint combines editing and completion for better UX
 * Returns streaming response for the new completion
 */
const editUserMessageAndComplete = catchAsync(async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.user;
    const { content, model, autoComplete = true } = req.body;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Content is required and cannot be empty');
    }

    if (!model) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Model is required for completion');
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
        // Step 1: Edit the user message
        const editResult = await chatService.editUserMessage(chatId, content.trim(), userId);
        
        // Send edit confirmation
        res.write(`event: edit-complete\ndata: ${JSON.stringify({
            editedMessage: editResult.editedMessage,
            branchInfo: editResult.branchInfo
        })}\n\n`);

        if (!autoComplete) {
            res.write(`event: done\ndata: [DONE]\n\n`);
            return res.end();
        }

        // Step 2: Auto-generate new response
        const newUserChatId = editResult.editedMessage.chatId;
        
        // Check user balance first
        const user = await userService.getUserById(userId);
        const models = await openrouterService.fetchModels();
        const selectedModel = models.find(m => m.id === model);
        
        if (!selectedModel) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid model selected');
        }

        // Get conversation history up to the edited message
        const conversationHistory = await chatService.getActiveConversationHistory(
            editResult.editedMessage.conversationId, 
            editResult.editedMessage.messageIndex + 1
        );

        // Prepare messages for OpenRouter
        const messages = conversationHistory.map(chat => ({
            role: chat.role,
            content: chat.content
        }));

        // Estimate cost
        const estimatedPromptTokens = tokenCounter.countTokens(messages);
        const estimatedOutputTokens = Math.min(1000, selectedModel.context_length * 0.2);
        const exchangeRate = await settingService.getExchangeRate();
        const estimatedInputCostUSD = (estimatedPromptTokens / 1000) * selectedModel.pricing.prompt;
        const estimatedOutputCostUSD = (estimatedOutputTokens / 1000) * selectedModel.pricing.completion;
        const estimatedTotalCostUSD = estimatedInputCostUSD + estimatedOutputCostUSD;
        const estimatedTotalCostIDR = estimatedTotalCostUSD * exchangeRate;

        // Check balance
        if (user.balance < estimatedTotalCostIDR) {
            res.write(`event: error\ndata: ${JSON.stringify({ 
                error: 'Insufficient balance for completion',
                required: estimatedTotalCostIDR,
                current: user.balance
            })}\n\n`);
            return res.end();
        }

        // Send completion start event
        res.write(`event: completion-start\ndata: ${JSON.stringify({
            message: 'Starting AI response generation...'
        })}\n\n`);

        // Start streaming completion
        const { stream: responseStream } = await openrouterService.createChatCompletionStream(
            userId, model, messages
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

                    // Forward completion data to client
                    res.write(`event: completion-data\ndata: ${JSON.stringify(parsedData)}\n\n`);
                } catch (err) {
                    console.error('JSON parse error:', err.message, dataSliced);
                }
            }

            if (res.flush) res.flush();
        });

        stream.on('end', async () => {
            try {
                if (usage) {
                    const { prompt_tokens, completion_tokens, total_tokens } = usage;
                    const inputCostUSD = (prompt_tokens / 1000) * selectedModel.pricing.prompt;
                    const outputCostUSD = (completion_tokens / 1000) * selectedModel.pricing.completion;
                    const totalCostUSD = inputCostUSD + outputCostUSD;
                    const totalCostIDR = totalCostUSD * exchangeRate;

                    // Deduct from user balance
                    await userService.updateBalance(userId, -totalCostIDR);

                    // Create new assistant response
                    const assistantMessageIndex = await chatService.getNextMessageIndex(editResult.editedMessage.conversationId);
                    const newAssistantChat = await chatService.createChat({
                        conversationId: editResult.editedMessage.conversationId,
                        userId,
                        model,
                        role: 'assistant',
                        content: responseText,
                        parentChatId: newUserChatId,
                        messageIndex: assistantMessageIndex,
                        isActive: true,
                        isCurrentVersion: true,
                        versionNumber: 1,
                        promptTokens: prompt_tokens,
                        completionTokens: completion_tokens,
                        totalTokens: total_tokens,
                        costUSD: totalCostUSD,
                        costIDR: totalCostIDR
                    });

                    // Update parent-child relationship
                    const editedUserChat = await chatService.getChatById(newUserChatId, userId);
                    await editedUserChat.addChildChatId(newAssistantChat.chatId);

                    // Send completion result
                    res.write(`event: completion-complete\ndata: ${JSON.stringify({ 
                        usage, 
                        cost: { 
                            usd: totalCostUSD, 
                            idr: totalCostIDR 
                        },
                        assistantMessage: newAssistantChat.toJSON()
                    })}\n\n`);
                }

                res.write(`event: done\ndata: [DONE]\n\n`);
                res.end();
            } catch (error) {
                console.error('Error saving completion:', error);
                res.write(`event: error\ndata: ${JSON.stringify({ error: 'Error saving completion results' })}\n\n`);
                res.end();
            }
        });

        stream.on('error', (error) => {
            res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        });

        req.on('close', () => {
            if (stream) stream.destroy();
        });

    } catch (error) {
        console.error('Edit and complete error:', error);
        if (stream) stream.destroy();

        res.write(`event: error\ndata: ${JSON.stringify({ 
            error: error.message || 'An error occurred during edit and completion' 
        })}\n\n`);
        res.end();
    }
});

/**
 * Edit user message only (no auto-completion)
 * PUT /api/chat/:chatId/edit
 * 
 * Body:
 * - content: New message content (required)
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
 * Get all versions of a specific chat with pagination
 * GET /api/chat/:chatId/versions
 * 
 * Query Parameters:
 * - limit: Number of versions to return (default: 10)
 * - page: Page number (default: 1)
 */
const getChatVersions = catchAsync(async (req, res) => {
    const { chatId } = req.params;
    const { userId } = req.user;
    const { limit = 10, page = 1 } = req.query;

    const versions = await chatService.getChatVersions(chatId, userId);
    
    // Apply pagination
    const sanitizedLimit = Math.min(Math.max(1, parseInt(limit)), 50);
    const sanitizedPage = Math.max(1, parseInt(page));
    const startIndex = (sanitizedPage - 1) * sanitizedLimit;
    const endIndex = startIndex + sanitizedLimit;
    const paginatedVersions = versions.slice(startIndex, endIndex);
    
    res.status(httpStatus.OK).send({
        success: true,
        data: {
            versions: paginatedVersions,
            pagination: {
                page: sanitizedPage,
                limit: sanitizedLimit,
                total: versions.length,
                totalPages: Math.ceil(versions.length / sanitizedLimit),
                hasMore: endIndex < versions.length
            }
        }
    });
});

/**
 * Switch to a specific version of a chat
 * POST /api/chat/:chatId/switch-version
 * 
 * Body:
 * - versionNumber: Version number to switch to (required)
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
 * Generate new assistant response for a user message
 * POST /api/chat/:chatId/generate
 * 
 * Body:
 * - model: Model to use for generation (required)
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
 * Delete a chat message
 * DELETE /api/chat/:chatId
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
    editUserMessageAndComplete,
    generateResponse,
    switchToVersion,
    getChatVersions,
    deleteChat,
    chatCompletionStream,
    processFileStream
};