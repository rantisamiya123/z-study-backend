const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const passport = require('passport'); // jwt
const httpStatus = require('http-status');
const mongoSanitize = require('express-mongo-sanitize');
const morgan = require('morgan');
const routes = require('./routes');
const { errorConverter, errorHandler } = require('./middleware/error.middleware');
const ApiError = require('./utils/error.util');
const { jwtStrategy } = require('./config/passport');
const { env } = require('./config/environment');
const logger = require('./utils/logger.util');
const dbConnect = require('./config/database');
const cronJobs = require('./utils/cron');
const mongoose = require('mongoose');
// Connect to MongoDB
dbConnect();

const app = express();

mongoose
  .connect(env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    // Tambahkan opsi lain sesuai kebutuhan
  })
  .then(() => {
    console.log('Connected to MongoDB');
    
    // Mulai cron jobs setelah terhubung ke database
    cronJobs.start();
  })
  .catch((err) => {
    console.error('MongoDB connection error', err);
    process.exit(1);
  });

// Set security HTTP headers
app.use(helmet());

// Parse JSON request body
app.use(express.json());

// Parse URL-encoded request body
app.use(express.urlencoded({ extended: true }));

// Sanitize request data
app.use(mongoSanitize());

// Gzip compression
app.use(compression());

// Request logging
if (env.NODE_ENV !== 'test') {
  app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
}

console.log("fe:",env.APP_URL)

// CORS configuration - only allow registered origins
const corsOptions = {
  origin: [env.APP_URL],  
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// JWT authentication
app.use(passport.initialize());
passport.use('jwt', jwtStrategy);

// Routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
  res.status(200).send({ status: 'ok' });
});

// Send 404 error for any unknown API request
app.use((req, res, next) => {
  next(new ApiError(httpStatus.NOT_FOUND, 'Not found'));
});

// Convert errors to ApiError, if needed
app.use(errorConverter);

// Error handler
app.use(errorHandler);

// Start server
const PORT = env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

module.exports = app;
