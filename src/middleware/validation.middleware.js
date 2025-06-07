const Joi = require('joi');
const httpStatus = require('http-status');
const _ = require('lodash');
const ApiError = require('../utils/error.util');

/**
 * Validation middleware factory
 * @param {Object} schema - Joi validation schema
 * @returns {Function} Express middleware
 */
const validate = (schema) => (req, res, next) => {
  // Extract the validation schema for request parts
  const { params, query, body } = schema;
  
  // Create a validation object for each request part
  const validationObj = {};
  if (params) validationObj.params = req.params;
  if (query) validationObj.query = req.query;
  if (body) validationObj.body = req.body;
  
  // Joi validation options
  const options = {
    abortEarly: false, // Include all errors
    allowUnknown: true, // Ignore unknown props
    stripUnknown: false // Keep unknown props
  };
  
  // Create validation schema
  const validationSchema = Joi.object({
    params: params && Joi.object(params),
    query: query && Joi.object(query),
    body: body && Joi.object(body)
  }).extract(Object.keys(validationObj));
  
  // Validate
  const { error, value } = validationSchema.validate(validationObj, options);
  
  if (error) {
    // Format error message
    const errorMessage = error.details
      .map((detail) => detail.message.replace(/['"]/g, ''))
      .join(', ');
      
    // Return validation error
    return next(new ApiError(httpStatus.BAD_REQUEST, errorMessage));
  }
  
  // Update validated values
  if (value.params) _.assign(req.params, value.params);
  if (value.query) _.assign(req.query, value.query);
  if (value.body) _.assign(req.body, value.body);
  
  next();
};

/**
 * Password validation schema (reusable)
 */
const passwordSchema = Joi.string()
  .min(8)
  .pattern(/[0-9]/)
  .pattern(/[a-z]/)
  .pattern(/[A-Z]/)
  .pattern(/[^a-zA-Z0-9]/)
  .message('Password must be at least 8 characters, contain at least one uppercase letter, one lowercase letter, one number, and one special character');

/**
 * Common validation schemas
 */
const validations = {
  auth: {
    register: {
      body: {
        email: Joi.string().email().required(),
        password: passwordSchema.required(),
        name: Joi.string().min(2).max(100).required(),
      },
    },
    login: {
      body: {
        email: Joi.string().email().required(),
        password: Joi.string().required(),
      },
    },
    refreshToken: {
      body: {
        refreshToken: Joi.string().required(),
      },
    },
  },
  user: {
    getUserProfile: {},
    updateUserProfile: {
      body: {
        name: Joi.string().min(2).max(100),
        password: passwordSchema,
      },
    },
  },
  topup: {
    createTopup: {
      body: {
        amount: Joi.number().min(10000).required()
          .messages({
            'number.min': 'Minimum topup amount is 10000 IDR',
            'number.base': 'Amount must be a number',
            'any.required': 'Amount is required',
          }),
      },
    },
    checkStatus: {
      params: {
        topupId: Joi.string().required(),
      },
    },
  },
  llm: {
    chatCompletion: {
      body: {
        model: Joi.string().required(),
        messages: Joi.array().items(
          Joi.object({
            role: Joi.string().valid('system', 'user', 'assistant').required(),
            content: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(
                Joi.object({
                  type: Joi.string().valid('text', 'image').required(),
                  text: Joi.when('type', {
                    is: 'text',
                    then: Joi.string().required(),
                    otherwise: Joi.string().optional(),
                  }),
                  image_url: Joi.when('type', {
                    is: 'image',
                    then: Joi.object({
                      url: Joi.string().uri().required(),
                    }).required(),
                    otherwise: Joi.forbidden(),
                  }),
                })
              )
            ).required(),
          })
        ).min(1).required(),
        max_tokens: Joi.number().integer().min(1).max(32000).optional(),
      },
    },
    processFile: {
      body: {
        fileId: Joi.string().required(),
        model: Joi.string().required(),
        prompt: Joi.string().required(),
      },
    },
  },
  admin: {
    updateExchangeRate: {
      body: {
        usdToIdr: Joi.number().min(10000).max(20000).required()
          .messages({
            'number.min': 'Exchange rate must be at least 10000',
            'number.max': 'Exchange rate must not exceed 20000',
            'number.base': 'Exchange rate must be a number',
            'any.required': 'Exchange rate is required',
          }),
      },
    },
    updateUserStatus: {
      params: {
        userId: Joi.string().required(),
      },
      body: {
        status: Joi.string().valid('active', 'banned').required(),
      },
    },
  },
};

module.exports = {
  validate,
  validations,
  passwordSchema,
};
