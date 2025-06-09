const httpStatus = require('http-status');
const openrouterService = require('../services/openrouter.service');
const fileService = require('../services/file.service');
const userService = require('../services/user.service');
const chatService = require('../services/chat.service');
const settingService = require('../services/setting.service');
const catchAsync = require('../utils/catchAsync.util');
const ApiError = require('../utils/error.util');

/**
 * Get available LLM models
 */
const getModels = catchAsync(async (req, res) => {
  const {
    search = '',
    modalities = '',
    sort = 'price-asc',
    page = 1,
    limit = 50,
    group = false
  } = req.query;

  // Parse modalities from comma-separated string
  const modalityFilters = modalities ? modalities.split(',').filter(Boolean) : [];

  const options = {
    search: search.trim(),
    modalities: modalityFilters,
    sort,
    page: parseInt(page),
    limit: parseInt(limit),
    group: group === 'true'
  };

  const result = await openrouterService.searchModels(options);
  
  res.status(httpStatus.OK).send({ 
    success: true, 
    data: result
  });
});

const getModelMarketing = catchAsync(async (req, res) => {
  const {
    search = '',
    providers = '',
    modelIds = '',
    category = '',
    page = 1,
    limit = 20,
    maxModels = 100
  } = req.query;

  // Parse providers dari comma-separated string (openai, deepseek, claude, dll)
  const providerFilters = providers ? providers.split(',').map(p => p.trim().toLowerCase()).filter(Boolean) : [];
  
  // Parse model IDs dari comma-separated string
  const modelIdFilters = modelIds ? modelIds.split(',').map(id => id.trim()).filter(Boolean) : [];

  const options = {
    search: search.trim(),
    providers: providerFilters,
    modelIds: modelIdFilters,
    category: category.trim(),
    page: parseInt(page),
    limit: Math.min(parseInt(limit), 50), // maksimal 50 per halaman
    maxModels: Math.min(parseInt(maxModels), 500) // maksimal 500 total models
  };

  const result = await openrouterService.searchModelMarketing(options);
  
  res.status(httpStatus.OK).send({ 
    success: true, 
    data: result
  });
});

/**
 * Chat completion (non-streaming)
 */
const chatCompletion = catchAsync(async (req, res) => {
  const { model, messages, max_tokens } = req.body;
  const { userId } = req.user;

  const result = await openrouterService.createChatCompletion(userId, model, messages, { max_tokens });
  
  res.status(httpStatus.OK).send({ success: true, data: result });
});

/**
 * Chat completion (streaming)
 */
const chatCompletionStream = catchAsync(async (req, res) => {
  const { model, messages, max_tokens } = req.body;
  const { userId } = req.user;

  // Penting: Set header yang benar untuk streaming
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Transfer-Encoding': 'chunked',
    'X-Accel-Buffering': 'no'
  });

  try {
    const { stream } = await openrouterService.createChatCompletionStream(
      userId, model, messages, { max_tokens }
    );

    // Forward stream langsung ke client
    stream.on('data', (chunk) => {
      const data = chunk.toString();
      // Kirim chunk langsung
      res.write(`data: ${data}\n\n`);
      // Force flush buffer
      if (res.flush) res.flush();
    });

    stream.on('end', () => {
      res.write('data: [DONE]\n\n');
      res.end();
    });

    stream.on('error', (error) => {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    });

    // Handle client disconnect
    req.on('close', () => {
      stream.destroy();
    });

  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

/**
 * Upload file (PDF, image, etc.)
 */
const uploadFile = catchAsync(async (req, res) => {
  if (!req.file) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No file uploaded');
  }

  const { userId } = req.user;
  const fileData = await fileService.saveFile(userId, req.file);

  res.status(httpStatus.OK).send({ 
    success: true, 
    data: {
      fileId: fileData.fileId,
      fileUrl: fileData.fileUrl,
      fileType: fileData.fileType
    } 
  });
});

/**
 * Process uploaded file with LLM
 */
const processFile = catchAsync(async (req, res) => {
  const { fileId, model, prompt } = req.body;
  const { userId } = req.user;

  // Get file details
  const file = await fileService.getFileById(fileId, userId);
  if (!file) {
    throw new ApiError(httpStatus.NOT_FOUND, 'File not found');
  }

  // Process the file with LLM
  const result = await openrouterService.processFileWithLLM(
    userId, 
    file.fileUrl, 
    file.fileType, 
    model, 
    prompt
  );

  res.status(httpStatus.OK).send({ success: true, data: result });
});

/**
 * Safely parse SSE data as JSON
 * @param {string} data - The data string from an SSE event
 * @returns {Object|null} Parsed JSON or null if parsing failed
 */
const safeJsonParse = (data) => {
  try {
    return JSON.parse(data);
  } catch (error) {
    console.error('Error parsing SSE data:', error.message, 'Data:', data);
    return null;
  }
};

/**
 * Process uploaded file with LLM (streaming)
 */
const processFileStream = catchAsync(async (req, res) => {
  const { fileId, model, prompt, max_tokens } = req.body;
  const { userId } = req.user;

  // Get file details
  const file = await fileService.getFileById(fileId, userId);
  if (!file) {
    throw new ApiError(httpStatus.NOT_FOUND, 'File not found');
  }

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  try {
    const { stream, validation } = await openrouterService.processFileWithLLMStream(
      userId, 
      file.fileUrl, 
      file.fileType, 
      model, 
      prompt,
      { max_tokens }
    );
    
    let responseText = '';
    let usage = null;
    let buffer = ''; // Buffer for incomplete lines
    
    // Forward the stream from OpenRouter to client
    stream.on('data', (chunk) => {
      const chunkStr = buffer + chunk.toString();
      buffer = ''; // Reset buffer after using it
      
      // Split by double newlines which separate SSE events
      const events = chunkStr.split('\n\n');
      
      // The last element might be incomplete, save it to buffer
      if (events.length > 0 && chunkStr.slice(-2) !== '\n\n') {
        buffer = events.pop();
      }
      
      for (const event of events) {
        if (!event.trim()) continue;
        
        // Process each line in the event
        const lines = event.split('\n');
        let eventData = '';
        let eventType = 'message'; // Default event type
        
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.substring(7);
          } else if (line.startsWith('data: ')) {
            eventData = line.substring(6);
          }
        }
        
        // Skip empty data
        if (!eventData) continue;
        
        // Check if it's the [DONE] message
        if (eventData === '[DONE]') {
          res.write('event: done\ndata: [DONE]\n\n');
          continue;
        }
        
        // Parse JSON data safely
        const parsedData = safeJsonParse(eventData);
        if (!parsedData) continue;
        
        // If we have usage info, capture it
        if (parsedData.usage) {
          usage = parsedData.usage;
        }
        
        // Collect the response text
        if (parsedData.choices && parsedData.choices[0].delta && parsedData.choices[0].delta.content) {
          responseText += parsedData.choices[0].delta.content;
        }
        
        // Forward to client
        res.write(`data: ${eventData}\n\n`);
      }
    });
    
    // When stream ends, calculate costs and update user balance
    stream.on('end', async () => {
      if (usage) {
        // Calculate costs
        const { prompt_tokens, completion_tokens, total_tokens } = usage;
        const modelDetails = (await openrouterService.fetchModels()).find(m => m.id === model);
        const exchangeRate = await settingService.getExchangeRate();
        
        const inputCostUSD = (prompt_tokens / 1000) * modelDetails.inputPricePer1000Tokens;
        const outputCostUSD = (completion_tokens / 1000) * modelDetails.outputPricePer1000Tokens;
        const totalCostUSD = inputCostUSD + outputCostUSD;
        const totalCostIDR = totalCostUSD * exchangeRate;
        
        // Deduct from user balance
        await userService.updateBalance(userId, -totalCostIDR);
        
        // Record the chat
        await chatService.recordChatUsage({
          userId,
          model,
          promptTokens: prompt_tokens,
          completionTokens: completion_tokens,
          totalTokens: total_tokens,
          costUSD: totalCostUSD,
          costIDR: totalCostIDR,
          content: {
            prompt: prompt, // Store the original prompt
            fileId: fileId, // Store the file reference
            fileType: file.fileType,
            response: responseText
          }
        });
        
        // Send final usage and cost info to client
        res.write(`event: usage\ndata: ${JSON.stringify({
          usage,
          cost: {
            usd: totalCostUSD,
            idr: totalCostIDR
          }
        })}\n\n`);
      }
      
      // End the response
      res.end();
    });
    
    // Handle errors in the stream
    stream.on('error', (error) => {
      console.error('Stream error:', error);
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'Stream error occurred' })}\n\n`);
      res.end();
    });
    
    // Handle client disconnect
    req.on('close', () => {
      stream.destroy();
    });
  } catch (error) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
    res.end();
  }
});

module.exports = {
  getModels,
  getModelMarketing,
  chatCompletion,
  chatCompletionStream,
  uploadFile,
  processFile,
  processFileStream,
  safeJsonParse
};
