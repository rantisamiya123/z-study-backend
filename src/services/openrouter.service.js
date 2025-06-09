const axios = require('axios');
const httpStatus = require('http-status');
const { openrouter, env } = require('../config/environment');
const ApiError = require('../utils/error.util');
const logger = require('../utils/logger.util');
const tokenCounter = require('../utils/tokenCounter.util');
const settingService = require('./setting.service');
const userService = require('./user.service');
const chatService = require('./chat.service');

const MODELS_CACHE = {
  data: null,
  timestamp: 0
};

/**
 * Fetch available models from OpenRouter
 * @returns {Promise<Array>} Available models
 */
const fetchModels = async () => {
  try {
    // Check cache validity (cache for 1 hour)
    const now = Date.now();
    if (MODELS_CACHE.data && now - MODELS_CACHE.timestamp < 3600000) {
      return MODELS_CACHE.data;
    }

    // Fetch models from OpenRouter
    const response = await axios.get('https://openrouter.ai/api/v1/models', {
      headers: {
        Authorization: `Bearer ${openrouter.API_KEY}`
      }
    });

    // Format and store in cache
    const models = response.data.data;

    MODELS_CACHE.data = models;
    MODELS_CACHE.timestamp = now;

    return models;
  } catch (error) {
    logger.error('Error fetching models from OpenRouter:', error);
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Failed to fetch available models');
  }
};

/**
 * Fetch and process models from OpenRouter with filtering, sorting, and pagination
 * @param {Object} options - Query options
 * @param {string} options.search - Search query
 * @param {Array} options.modalities - Array of modality filters
 * @param {string} options.sort - Sort option
 * @param {number} options.page - Page number
 * @param {number} options.limit - Items per page
 * @param {boolean} options.group - Whether to group by modality
 * @returns {Promise<Object>} Processed models data
 */
const searchModels = async (options = {}) => {
  try {
    const {
      search = '',
      modalities = [],
      sort = 'price-asc',
      page = 1,
      limit = 50,
      group = false
    } = options;

    // Check cache validity (cache for 1 hour)
    const now = Date.now();
    let allModels;
    
    if (MODELS_CACHE.data && now - MODELS_CACHE.timestamp < 3600000) {
      allModels = MODELS_CACHE.data;
    } else {
      // Fetch models from OpenRouter
      const response = await axios.get('https://openrouter.ai/api/v1/models', {
        headers: {
          Authorization: `Bearer ${openrouter.API_KEY}`
        }
      });

      allModels = response.data.data;
      MODELS_CACHE.data = allModels;
      MODELS_CACHE.timestamp = now;
    }

    // Apply filters
    let filteredModels = [...allModels];

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      filteredModels = filteredModels.filter(model => 
        model.name.toLowerCase().includes(searchLower) ||
        (model.description && model.description.toLowerCase().includes(searchLower))
      );
    }

    // Modality filter
    if (modalities.length > 0) {
      filteredModels = filteredModels.filter(model => {
        const modelModalities = model.architecture?.input_modalities || [];
        return modalities.some(modality => modelModalities.includes(modality));
      });
    }

    // Helper function to get model price
    const getModelPrice = (model) => {
      return parseFloat(model.pricing?.prompt || '0');
    };

    // Apply sorting
    filteredModels.sort((a, b) => {
      switch (sort) {
        case 'price-asc':
          return getModelPrice(a) - getModelPrice(b);
        case 'price-desc':
          return getModelPrice(b) - getModelPrice(a);
        case 'context-desc':
          return (b.context_length || 0) - (a.context_length || 0);
        case 'name-asc':
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

    // Calculate pagination
    const totalModels = filteredModels.length;
    const totalPages = Math.ceil(totalModels / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedModels = filteredModels.slice(startIndex, endIndex);

    // Group by modality if requested
    let result;
    if (group) {
      const groupedModels = paginatedModels.reduce((acc, model) => {
        const modality = model.architecture?.modality || 'Unknown';
        if (!acc[modality]) {
          acc[modality] = [];
        }
        acc[modality].push(model);
        return acc;
      }, {});

      result = {
        models: groupedModels,
        pagination: {
          page,
          limit,
          total: totalModels,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        },
        filters: {
          search,
          modalities,
          sort
        }
      };
    } else {
      result = {
        models: paginatedModels,
        pagination: {
          page,
          limit,
          total: totalModels,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        },
        filters: {
          search,
          modalities,
          sort
        }
      };
    }

    return result;
  } catch (error) {
    logger.error('Error fetching models from OpenRouter:', error);
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Failed to fetch available models');
  }
};

/**
 * Fetch and process models from OpenRouter for marketing purposes with advanced filtering
 * @param {Object} options - Query options
 * @param {string} options.search - Search query for model name
 * @param {Array} options.providers - Array of provider filters (openai, deepseek, claude, etc)
 * @param {Array} options.modelIds - Array of specific model IDs to search
 * @param {string} options.category - Category filter from OpenRouter
 * @param {number} options.page - Page number
 * @param {number} options.limit - Items per page
 * @param {number} options.maxModels - Maximum total models to return
 * @returns {Promise<Object>} Processed models data with pagination
 */
const searchModelMarketing = async (options = {}) => {
  try {
    const {
      search = '',
      providers = [],
      modelIds = [],
      category = '',
      page = 1,
      limit = 20,
      maxModels = 100
    } = options;

    // Check cache validity (cache for 1 hour)
    const now = Date.now();
    let allModels;
    
    if (MODELS_CACHE.data && now - MODELS_CACHE.timestamp < 3600000) {
      allModels = MODELS_CACHE.data;
    } else {
      // Fetch models from OpenRouter
      const response = await axios.get('https://openrouter.ai/api/v1/models', {
        headers: {
          Authorization: `Bearer ${openrouter.API_KEY}`
        }
      });

      allModels = response.data.data;
      MODELS_CACHE.data = allModels;
      MODELS_CACHE.timestamp = now;
    }

    // Apply filters
    let filteredModels = allModels;

    // 1. Filter by specific model IDs (exact match)
    if (modelIds.length > 0) {
      filteredModels = filteredModels.filter(model => 
        modelIds.some(id => model.id.toLowerCase().includes(id.toLowerCase()))
      );
    }

    // 2. Filter by providers (openai, deepseek, claude, etc)
    if (providers.length > 0) {
      filteredModels = filteredModels.filter(model => {
        const modelProvider = model.id.split('/')[0]?.toLowerCase() || '';
        const modelName = model.name.toLowerCase();
        
        return providers.some(provider => {
          switch(provider) {
            case 'openai':
              return modelProvider === 'openai' || modelName.includes('gpt') || modelName.includes('openai');
            case 'deepseek':
              return modelProvider.includes('deepseek') || modelName.includes('deepseek');
            case 'claude':
              return modelProvider === 'anthropic' || modelName.includes('claude');
            case 'google':
              return modelProvider === 'google' || modelName.includes('gemini') || modelName.includes('palm');
            case 'meta':
              return modelProvider === 'meta' || modelName.includes('llama');
            case 'mistral':
              return modelProvider === 'mistral' || modelName.includes('mistral');
            default:
              return modelProvider.includes(provider) || modelName.includes(provider);
          }
        });
      });
    }

    // 3. Filter by search term (nama model)
    if (search) {
      const searchLower = search.toLowerCase();
      filteredModels = filteredModels.filter(model => 
        model.name.toLowerCase().includes(searchLower) ||
        model.id.toLowerCase().includes(searchLower) ||
        model.description?.toLowerCase().includes(searchLower)
      );
    }

    // 4. Filter by category (berdasarkan modality atau architecture)
    if (category) {
      const categoryLower = category.toLowerCase();
      filteredModels = filteredModels.filter(model => {
        const modality = model.architecture?.modality?.toLowerCase() || '';
        const inputModalities = model.architecture?.input_modalities?.join(',').toLowerCase() || '';
        const outputModalities = model.architecture?.output_modalities?.join(',').toLowerCase() || '';
        
        return modality.includes(categoryLower) || 
               inputModalities.includes(categoryLower) || 
               outputModalities.includes(categoryLower) ||
               (categoryLower === 'text' && modality.includes('text')) ||
               (categoryLower === 'multimodal' && (inputModalities.includes('image') || inputModalities.includes('file'))) ||
               (categoryLower === 'vision' && inputModalities.includes('image')) ||
               (categoryLower === 'code' && (model.name.toLowerCase().includes('code') || model.description?.toLowerCase().includes('coding')));
      });
    }

    // 5. Apply maxModels limit
    if (maxModels && filteredModels.length > maxModels) {
      filteredModels = filteredModels.slice(0, maxModels);
    }

    // 6. Sort models (default by name)
    filteredModels.sort((a, b) => {
      // Prioritas: OpenAI > Anthropic > Google > Meta > lainnya
      const providerPriority = {
        'openai': 1,
        'anthropic': 2,
        'google': 3,
        'meta': 4
      };
      
      const aProvider = a.id.split('/')[0]?.toLowerCase() || '';
      const bProvider = b.id.split('/')[0]?.toLowerCase() || '';
      
      const aPriority = providerPriority[aProvider] || 99;
      const bPriority = providerPriority[bProvider] || 99;
      
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      
      return a.name.localeCompare(b.name);
    });

    // 7. Apply pagination
    const totalItems = filteredModels.length;
    const totalPages = Math.ceil(totalItems / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedModels = filteredModels.slice(startIndex, endIndex);

    // 8. Format response data
    const formattedModels = paginatedModels.map(model => ({
      id: model.id,
      name: model.name,
      provider: model.id.split('/')[0] || 'unknown',
      description: model.description || '',
      created: model.created,
      context_length: model.context_length,
      modality: model.architecture?.modality || '',
      input_modalities: model.architecture?.input_modalities || [],
      output_modalities: model.architecture?.output_modalities || [],
      pricing: {
        prompt: parseFloat(model.pricing?.prompt || 0),
        completion: parseFloat(model.pricing?.completion || 0),
        image: parseFloat(model.pricing?.image || 0)
      },
      features: {
        supports_tools: model.supported_parameters?.includes('tools') || false,
        supports_vision: model.architecture?.input_modalities?.includes('image') || false,
        supports_files: model.architecture?.input_modalities?.includes('file') || false,
        max_tokens: model.top_provider?.max_completion_tokens || null
      }
    }));

    const result = {
      models: formattedModels,
      pagination: {
        current_page: page,
        total_pages: totalPages,
        total_items: totalItems,
        items_per_page: limit,
        has_next: page < totalPages,
        has_prev: page > 1
      },
      filters_applied: {
        search: search || null,
        providers: providers.length > 0 ? providers : null,
        model_ids: modelIds.length > 0 ? modelIds : null,
        category: category || null,
        max_models: maxModels
      },
      summary: {
        total_filtered: totalItems,
        providers_found: [...new Set(formattedModels.map(m => m.provider))],
        categories_found: [...new Set(formattedModels.map(m => m.modality).filter(Boolean))]
      }
    };

    return result;
  } catch (error) {
    logger.error('Error fetching marketing models from OpenRouter:', error);
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Failed to fetch marketing models data');
  }
};

/**
 * Validate model and check user balance
 * @param {string} userId - User ID
 * @param {string} model - Model ID
 * @param {Array} messages - Messages array
 * @param {number} maxTokens - Maximum tokens for completion
 * @returns {Promise<Object>} Validation result
 */
const validateModelAndBalance = async (userId, model, messages, maxTokens) => {
  // 1. Get the user
  const user = await userService.getUserById(userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

  // 2. Get all available models
  const availableModels = await fetchModels();
  const selectedModel = availableModels.find(m => m.id === model);
  if (!selectedModel) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid model selected');
  }

  // 3. Get current exchange rate
  const exchangeRate = await settingService.getExchangeRate();

  // 4. Estimate token count
  const estimatedPromptTokens = tokenCounter.countTokens(messages);
  
  // Validate max_tokens parameter
  const providedMaxTokens = maxTokens || selectedModel.maxTokens / 2;
  if (providedMaxTokens > selectedModel.maxTokens) {
    throw new ApiError(
      httpStatus.BAD_REQUEST, 
      `max_tokens exceeds model limit of ${selectedModel.maxTokens}`
    );
  }
  
  // 5. Calculate maximum possible cost (worst case)
  const maxInputCostUSD = (estimatedPromptTokens / 1000) * selectedModel.inputPricePer1000Tokens;
  const maxOutputCostUSD = (providedMaxTokens / 1000) * selectedModel.outputPricePer1000Tokens;
  const maxTotalCostUSD = maxInputCostUSD + maxOutputCostUSD;
  const maxTotalCostIDR = maxTotalCostUSD * exchangeRate;

  // 6. Check if user has sufficient balance
  if (user.balance < maxTotalCostIDR) {
    throw new ApiError(
      httpStatus.PAYMENT_REQUIRED, 
      `Insufficient balance. Maximum possible cost is IDR ${maxTotalCostIDR.toFixed(2)}, your balance is IDR ${user.balance.toFixed(2)}`
    );
  }

  return {
    user,
    selectedModel,
    exchangeRate,
    estimatedPromptTokens,
    maxTotalCostUSD,
    maxTotalCostIDR
  };
};

/**
 * Create a chat completion request (non-streaming)
 * @param {string} userId - User ID
 * @param {string} model - Model ID
 * @param {Array} messages - Messages array
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Completion result
 */
const createChatCompletion = async (userId, model, messages, options = {}) => {
  try {
    // Get model details for pricing
    const models = await fetchModels();
    const selectedModel = models.find(m => m.id === model);
    if (!selectedModel) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid model selected');
    }
    // Call OpenRouter API for non-streaming completion
    const response = await axios.post(
      openrouter.ENDPOINT,
      {
        model,
        messages,
        ...options,
        stream: false
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openrouter.API_KEY}`,
          'HTTP-Referer': env.APP_URL,
          'X-Title': 'LLM Topup Service'
        }
      }
    );

    const { id, choices, usage } = response.data;
    
    if (!choices || choices.length === 0) {
      throw new ApiError(httpStatus.BAD_GATEWAY, 'No response choices received from OpenRouter');
    }

    if (!usage) {
      throw new ApiError(httpStatus.BAD_GATEWAY, 'No usage information received from OpenRouter');
    }

    // Return the completion result
    // Cost calculation and balance update will be handled in the controller
    return {
      id,
      message: choices[0].message,
      usage,
      model: selectedModel // Include model details for pricing calculation
    };

  } catch (error) {
    if (error.response) {
      logger.error('OpenRouter API error:', error.response.data);
      throw new ApiError(
        httpStatus.BAD_GATEWAY,
        `OpenRouter error: ${error.response.data.error?.message || 'Unknown error'}`
      );
    }
    throw error;
  }
};

/**
 * Generate conversation title using a free model
 * @param {String} messages - The conversation messages to summarize
 * @returns {Promise<string>} - Generated title
 */
const generateConversationTitle = async (messages) => {
  try {
    // Use a free or cheap model for title generation
    const FREE_MODEL = 'meta-llama/llama-3.2-3b-instruct:free'; // Adjust based on available free models
    
    // Extract the first user message for context
    const firstUserMessage = messages.content;
    if (!firstUserMessage) {
      return 'New Conversation';
    }

    // Create a prompt for title generation
    const titlePrompt = [
      {
        role: 'system',
        content: 'Generate a concise, descriptive title (max 50 characters) for this conversation based on the user\'s first message. Return only the title, no quotes or extra text.'
      },
      {
        role: 'user',
        content: `Generate a title for this conversation: "${firstUserMessage.content.substring(0, 200)}"`
      }
    ];

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': process.env.OPENROUTER_SITE_NAME || 'ChatApp'
      },
      body: JSON.stringify({
        model: FREE_MODEL,
        messages: titlePrompt,
        max_tokens: 20,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      console.warn('Failed to generate title, using default');
      return 'New Conversation';
    }

    const data = await response.json();
    const generatedTitle = data.choices?.[0]?.message?.content?.trim();
    
    // Validate and clean the title
    if (generatedTitle && generatedTitle.length > 0) {
      // Remove quotes if present and limit length
      const cleanTitle = generatedTitle.replace(/^["']|["']$/g, '').substring(0, 50);
      return cleanTitle || 'New Conversation';
    }

    return 'New Conversation';
  } catch (error) {
    console.error('Error generating conversation title:', error);
    return 'New Conversation';
  }
};

/**
 * Create a streaming chat completion request
 * @param {string} userId - User ID
 * @param {string} model - Model ID
 * @param {Array} messages - Messages array
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Stream and validation data
 */
const createChatCompletionStream = async (userId, model, messages, options = {}) => {
  try {
    // Validate model, user balance, etc.
    const validation = await validateModelAndBalance(userId, model, messages, options.max_tokens);
    
    // Setup streaming request to OpenRouter
    const response = await axios.post(
      openrouter.ENDPOINT,
      {
        model,
        messages,
        ...options,
        stream: true
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openrouter.API_KEY}`,
          'HTTP-Referer': env.APP_URL,
          'X-Title': 'LLM Topup Service'
        },
        responseType: 'stream'
      }
    );
    
    // We'll process and track usage in the controller when stream is complete
    return {
      stream: response.data,
      validation
    };
  } catch (error) {
    if (error.response) {
      logger.error('OpenRouter API streaming error:', error.response.data);
      throw new ApiError(
        httpStatus.BAD_GATEWAY,
        `OpenRouter error: ${error.response.data.error?.message || 'Unknown error'}`
      );
    }
    throw error;
  }
};

/**
 * Process a file with an LLM model
 * @param {string} userId - User ID
 * @param {string} fileUrl - URL of the file
 * @param {string} fileType - Type of file (pdf/image/etc)
 * @param {string} model - Model ID
 * @param {string} prompt - User prompt
 * @returns {Promise<Object>} Processing result
 */
const processFileWithLLM = async (userId, fileUrl, fileType, model, prompt) => {
  try {
    let messages = [];
    
    // Create appropriate messages based on file type
    if (fileType === 'image') {
      messages = [
        { role: 'system', content: 'You are an AI assistant that helps analyze images.' },
        { role: 'user', content: [
          {
            type: 'image_url',
            image_url: { url: fileUrl }
          },
          {
            type: 'text',
            text: prompt
          }
        ]}
      ];
    } else {
      // For other file types, the text should be extracted and passed here
      messages = [
        { role: 'system', content: 'You are an AI assistant that helps analyze documents.' },
        { role: 'user', content: prompt }
      ];
    }
    
    // Use standard chat completion API
    return await createChatCompletion(userId, model, messages);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR, 
      'Failed to process file with LLM'
    );
  }
};

/**
 * Process a file with an LLM model with streaming response
 * @param {string} userId - User ID
 * @param {string} fileUrl - URL of the file
 * @param {string} fileType - Type of file (pdf/image/etc)
 * @param {string} model - Model ID
 * @param {string} prompt - User prompt
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Stream and validation data
 */
const processFileWithLLMStream = async (userId, fileUrl, fileType, model, prompt, options = {}) => {
  try {
    let messages = [];
    
    // Create appropriate messages based on file type
    if (fileType === 'image') {
      messages = [
        { role: 'system', content: 'You are an AI assistant that helps analyze images.' },
        { role: 'user', content: [
          {
            type: 'image_url',
            image_url: { url: fileUrl }
          },
          {
            type: 'text',
            text: prompt
          }
        ]}
      ];
    } else {
      // For other file types, the text should be extracted and passed here
      messages = [
        { role: 'system', content: 'You are an AI assistant that helps analyze documents.' },
        { role: 'user', content: prompt }
      ];
    }
    
    // Use streaming chat completion API with the created messages
    return await createChatCompletionStream(userId, model, messages, options);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR, 
      'Failed to process file with LLM stream'
    );
  }
};

module.exports = {
  fetchModels,
  searchModels,
  validateModelAndBalance,
  createChatCompletion,
  createChatCompletionStream,
  processFileWithLLM,
  processFileWithLLMStream,
  generateConversationTitle,
  searchModelMarketing 
};