const multer = require('multer');
const httpStatus = require('http-status');
const ApiError = require('../utils/error.util');

// Configure storage as memory storage since we'll be uploading to S3
const storage = multer.memoryStorage();

// Define file filter to restrict file types (optional)
const fileFilter = (req, file, cb) => {
  // Accept images, pdfs, and text documents
  if (
    file.mimetype.startsWith('image/') ||
    file.mimetype === 'application/pdf' ||
    file.mimetype === 'text/plain' ||
    file.mimetype === 'text/markdown' ||
    file.mimetype === 'text/csv'
  ) {
    cb(null, true);
  } else {
    cb(new ApiError(httpStatus.BAD_REQUEST, 'Unsupported file type'), false);
  }
};

// Configure file size limits
const limits = {
  fileSize: 10 * 1024 * 1024, // 10MB limit
};

// Create and configure multer upload
const upload = multer({
  storage,
  fileFilter,
  limits,
});

module.exports = upload;