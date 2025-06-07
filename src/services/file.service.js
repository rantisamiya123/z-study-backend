const mongoose = require("mongoose");
const httpStatus = require("http-status");
const path = require("path");
const File = require("../models/file.model");
const ApiError = require("../utils/error.util");
const {
  env
} = require("../config/environment");
const pdfParse = require("pdf-parse");

// Import specific AWS SDK v3 clients and commands
const {
  S3Client
} = require("@aws-sdk/client-s3");
const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const {
  getSignedUrl
} = require("@aws-sdk/s3-request-presigner");

// Configure S3 client
const s3Client = new S3Client({
  region: env.REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Upload file to S3
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} filename - File name
 * @param {string} mimetype - File MIME type
 * @returns {Promise<string>} S3 URL
 */
const uploadToS3 = async (buffer, filename, mimetype) => {
  const s3Key = `${Date.now()}-${filename}`; // Buat key unik
  const command = new PutObjectCommand({
    Bucket: env.AWS_S3_BUCKET,
    Key: s3Key,
    Body: buffer,
    ContentType: mimetype,
    ACL: "public-read",
  });

  await s3Client.send(command);

  const fileUrl = `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${s3Key}`;

  return {
    fileUrl,
    s3Key
  };
};

/**
 * Generate a presigned URL for accessing S3 files
 * @param {string} s3Url - Full S3 URL
 * @param {number} expirationSeconds - URL expiration in seconds
 * @returns {Promise<string>} Presigned URL
 */
const generatePresignedUrl = async (s3Url, expirationSeconds = 3600) => {
  try {
    // Extract bucket and key from S3 URL
    const urlObj = new URL(s3Url);
    const bucket = urlObj.hostname.split(".")[0];
    const key = urlObj.pathname.substring(1); // Remove leading slash

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    return await getSignedUrl(s3Client, command, {
      expiresIn: expirationSeconds,
    });
  } catch (error) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Failed to generate presigned URL"
    );
  }
};

/**
 * Save uploaded file information
 * @param {string} userId - User ID
 * @param {Object} fileData - File data from multer
 * @returns {Promise<Object>} File information
 */
const saveFile = async (userId, fileData) => {
  try {
    const {
      originalname,
      buffer,
      mimetype,
      size
    } = fileData;

    // Determine file type
    const extension = path.extname(originalname).toLowerCase();
    let fileType = 'document';

    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(extension)) {
      fileType = 'image';
    } else if (['.pdf'].includes(extension)) {
      fileType = 'pdf';
    } else if (['.txt', '.md', '.csv'].includes(extension)) {
      fileType = 'text';
    }

    // Upload to S3 (assumes function returns fileUrl and s3Key)
    const {
      fileUrl,
      s3Key
    } = await uploadToS3(buffer, originalname, mimetype);

    // Save file information to database
    const file = await File.create({
      userId,
      originalName: originalname,
      fileUrl,
      s3Key,
      fileType,
      mimeType: mimetype,
      fileSize: size
    });

    return {
      fileId: file._id,
      fileUrl,
      fileType,
      originalName: originalname,
      size
    };
  } catch (error) {
    console.error(error);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to process uploaded file');
  }
};


/**
 * Get file by ID
 * @param {string} fileId - File ID
 * @param {string} userId - User ID for authorization
 * @returns {Promise<Object>} File information
 */
const getFileById = async (fileId, userId) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(fileId)) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid file ID");
    }

    const file = await File.findOne({
      _id: fileId,
      userId,
    });

    if (!file) {
      throw new ApiError(httpStatus.NOT_FOUND, "File not found");
    }

    // Generate a presigned URL for accessing the file
    const presignedUrl = await generatePresignedUrl(file.fileUrl);

    return {
      fileId: file._id,
      fileUrl: presignedUrl,
      fileType: file.fileType,
      originalName: file.originalName,
      size: file.size,
      uploadedAt: file.createdAt,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Failed to retrieve file information"
    );
  }
};

/**
 * Delete a file
 * @param {string} fileId - File ID
 * @param {string} userId - User ID for authorization
 * @returns {Promise<boolean>} Success status
 */
const deleteFile = async (fileId, userId) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(fileId)) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid file ID");
    }

    // Find the file first to get its S3 URL
    const file = await File.findOne({
      _id: fileId,
      userId,
    });

    if (!file) {
      throw new ApiError(httpStatus.NOT_FOUND, "File not found");
    }

    // Extract bucket and key from S3 URL
    const urlObj = new URL(file.fileUrl);
    const bucket = urlObj.hostname.split(".")[0];
    const key = urlObj.pathname.substring(1); // Remove leading slash

    // Delete from S3
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    await s3Client.send(command);

    // Delete from database
    await File.deleteOne({
      _id: fileId
    });

    return true;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Failed to delete file"
    );
  }
};

/**
 * Extract text content from file (especially PDFs)
 * @param {string} fileId - File ID
 * @param {string} userId - User ID for authorization
 * @returns {Promise<string>} Extracted text content
 */
const extractTextFromFile = async (fileId, userId) => {
  try {
    // Get file information with the presigned URL
    const fileInfo = await getFileById(fileId, userId);

    // Only process PDFs for now
    if (fileInfo.fileType !== "pdf") {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Text extraction is currently only supported for PDF files"
      );
    }

    // Extract bucket and key from the original S3 URL (not the presigned one)
    const file = await File.findOne({
      _id: fileId,
      userId,
    });

    if (!file) {
      throw new ApiError(httpStatus.NOT_FOUND, "File not found");
    }

    const urlObj = new URL(file.fileUrl);
    const bucket = urlObj.hostname.split(".")[0];
    const key = urlObj.pathname.substring(1); // Remove leading slash

    // Download the file from S3
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await s3Client.send(command);

    // Convert the ReadableStream to a buffer
    let chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Extract text from PDF
    const result = await pdfParse(buffer);

    return result.text;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Failed to extract text from file"
    );
  }
};

/**
 * Get user's files
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @param {number} options.page - Page number
 * @param {number} options.limit - Items per page
 * @returns {Promise<Object>} Files with pagination
 */
const getUserFiles = async (userId, options = {}) => {
  try {
    const page = parseInt(options.page, 10) || 1;
    const limit = parseInt(options.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const [files, totalCount] = await Promise.all([
      File.find({
        userId
      })
      .sort({
        createdAt: -1
      })
      .skip(skip)
      .limit(limit)
      .lean(),
      File.countDocuments({
        userId
      }),
    ]);

    // Format response
    const formattedFiles = files.map((file) => ({
      fileId: file._id,
      originalName: file.originalName,
      fileType: file.fileType,
      size: file.size,
      uploadedAt: file.createdAt,
    }));

    return {
      files: formattedFiles,
      pagination: {
        total: totalCount,
        page,
        limit,
        pages: Math.ceil(totalCount / limit),
      },
    };
  } catch (error) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Failed to fetch files"
    );
  }
};

module.exports = {
  saveFile,
  getFileById,
  deleteFile,
  extractTextFromFile,
  getUserFiles,
  generatePresignedUrl,
};