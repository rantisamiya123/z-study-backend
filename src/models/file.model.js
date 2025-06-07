const mongoose = require('mongoose');

const fileSchema = mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    originalName: {
      type: String,
      required: true,
    },
    fileType: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
    },
    fileUrl: {
      type: String,
      required: true,
    },
    s3Key: {
      type: String,
      required: true,
    },
    isProcessed: {
      type: Boolean,
      default: false,
    },
    extractedText: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        ret.fileId = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.s3Key; // Don't expose S3 key to clients
        return ret;
      }
    }
  }
);

// Index for faster querying
fileSchema.index({ userId: 1, createdAt: -1 });
fileSchema.index({ s3Key: 1 }, { unique: true });

const File = mongoose.model('File', fileSchema);
module.exports = File;
