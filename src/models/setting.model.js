const mongoose = require('mongoose');
const { env } = require('../config/environment');

const settingSchema = mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    description: {
      type: String,
      default: '',
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret._id;
        delete ret.__v;
        return ret;
      }
    }
  }
);

// Initialize default settings
settingSchema.statics.initializeDefaultSettings = async function() {
  const defaults = [
    {
      key: 'exchangeRate',
      value: parseFloat(env.DEFAULT_USD_TO_IDR || 15500),
      description: 'USD to IDR exchange rate'
    },
    {
      key: 'maintenanceMode',
      value: false,
      description: 'Whether the application is in maintenance mode'
    },
    {
      key: 'serviceStatus',
      value: {
        auth: 'operational',
        chat: 'operational',
        payment: 'operational',
        fileUpload: 'operational'
      },
      description: 'Status of various services in the application'
    }
  ];

  const promises = defaults.map(async setting => {
    const exists = await this.findOne({ key: setting.key });
    if (!exists) {
      await this.create(setting);
    }
  });

  await Promise.all(promises);
};

const Setting = mongoose.model('Setting', settingSchema);

module.exports = Setting;
