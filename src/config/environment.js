const dotenv = require('dotenv');
const path = require('path');
const Joi = require('joi');

// Load .env file based on NODE_ENV
dotenv.config({
  path: path.join(__dirname, '../../.env')
});

// Environment variable validation schema
const envVarsSchema = Joi.object()
  .keys({
    NODE_ENV: Joi.string().valid('production', 'development', 'test').required(),
    PORT: Joi.number().default(3000),
    FRONTEND_URL: Joi.string().required().description('Frontend URL for CORS'),

    // MongoDB
    MONGODB_URI: Joi.string().required().description('MongoDB connection string'),

    // JWT
    JWT_SECRET: Joi.string().required().min(16).description('JWT secret key'),
    JWT_ACCESS_EXPIRATION: Joi.string().default('15m').description('JWT access token expiration time'),
    JWT_REFRESH_EXPIRATION: Joi.string().default('7d').description('JWT refresh token expiration time'),

    JWT_ACCESS_EXPIRATION_MINUTES: process.env.JWT_ACCESS_EXPIRATION_MINUTES || 30, // 30 menit
    JWT_REFRESH_EXPIRATION_DAYS: process.env.JWT_REFRESH_EXPIRATION_DAYS || 30, // 30 hari
    // OpenRouter
    OPENROUTER_API_KEY: Joi.string().required().description('OpenRouter API key'),
    OPENROUTER_ENDPOINT: Joi.string().uri().description('OpenRouter API endpoint'),

    // Google OAuth
    GOOGLE_CLIENT_ID: Joi.string().required().description('Google OAuth client ID'),
    GOOGLE_CLIENT_SECRET: Joi.string().required().description('Google OAuth client secret'),
    GOOGLE_CALLBACK_URL: Joi.string().uri().required().description('Google OAuth callback URL'),

    // AWS
    AWS_ACCESS_KEY_ID: Joi.string().required().description('AWS access key ID'),
    AWS_SECRET_ACCESS_KEY: Joi.string().required().description('AWS secret access key'),
    AWS_S3_BUCKET: Joi.string().required().description('AWS S3 bucket name'),
    AWS_REGION: Joi.string().default('ap-southeast-1').description('AWS region'),
    DYNAMODB_TABLE_PREFIX: Joi.string().required().description('AWS table prefix'),

    // Payment Gateway (for future use)
    PAYMENT_GATEWAY_API_KEY: Joi.string().description('Payment gateway API key'),
    PAYMENT_GATEWAY_SECRET: Joi.string().description('Payment gateway secret'),
    PAYMENT_CALLBACK_URL: Joi.string().uri().description('Payment gateway callback URL'),

    // Default Exchange Rate
    DEFAULT_USD_TO_IDR: Joi.number().default(15500).description('Default USD to IDR exchange rate')
  })
  .unknown();

const {
  value: envVars,
  error
} = envVarsSchema.prefs({
  errors: {
    label: 'key'
  }
}).validate(process.env);

if (error) {
  throw new Error(`Environment validation error: ${error.message}`);
}

// Export environment variables
const env = {
  NODE_ENV: envVars.NODE_ENV,
  PORT: envVars.PORT,
  FRONTEND_URL: envVars.FRONTEND_URL,

  // MongoDB
  MONGODB_URI: envVars.MONGODB_URI,

  // JWT
  JWT_SECRET: envVars.JWT_SECRET,
  JWT_ACCESS_EXPIRATION: envVars.JWT_ACCESS_EXPIRATION,
  JWT_REFRESH_EXPIRATION: envVars.JWT_REFRESH_EXPIRATION,

  // OpenRouter
  OPENROUTER_API_KEY: envVars.OPENROUTER_API_KEY,
  OPENROUTER_ENDPOINT: envVars.OPENROUTER_ENDPOINT,
  DYNAMODB_TABLE_PREFIX: envVars.DYNAMODB_TABLE_PREFIX,
  // Google OAuth
  GOOGLE_CLIENT_ID: envVars.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: envVars.GOOGLE_CLIENT_SECRET,
  GOOGLE_CALLBACK_URL: envVars.GOOGLE_CALLBACK_URL,

  // AWS
  AWS_ACCESS_KEY_ID: envVars.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: envVars.AWS_SECRET_ACCESS_KEY,
  AWS_S3_BUCKET: envVars.AWS_S3_BUCKET,
  AWS_REGION: envVars.AWS_REGION,

  // Payment Gateway
  PAYMENT_GATEWAY_API_KEY: envVars.PAYMENT_GATEWAY_API_KEY,
  PAYMENT_GATEWAY_SECRET: envVars.PAYMENT_GATEWAY_SECRET,
  PAYMENT_CALLBACK_URL: envVars.PAYMENT_CALLBACK_URL,

  // Exchange Rate
  DEFAULT_USD_TO_IDR: envVars.DEFAULT_USD_TO_IDR,

  // Application
  APP_URL: envVars.NODE_ENV === 'production' ?
    'http://localhost:5173'
    :
    `http://localhost:5173`
};

module.exports = {
  env,
  openrouter: {
    API_KEY: env.OPENROUTER_API_KEY,
    ENDPOINT: env.OPENROUTER_ENDPOINT || 'https://openrouter.ai/api/v1/chat/completions'
  }
};