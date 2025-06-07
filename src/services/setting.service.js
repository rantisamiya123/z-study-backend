const httpStatus = require('http-status');
const Setting = require('../models/setting.model');
const { env } = require('../config/environment');
const ApiError = require('../utils/error.util');

/**
 * Get exchange rate (USD to IDR)
 * @returns {Promise<number>} Exchange rate
 */
const getExchangeRate = async () => {
  try {
    // Get from database
    const setting = await Setting.findOne({ key: 'usd_to_idr' });
    
    // If not found, return default value and create it
    if (!setting) {
      const defaultRate = env.DEFAULT_USD_TO_IDR || 15500;
      await Setting.create({
        key: 'usd_to_idr',
        value: defaultRate,
        description: 'USD to IDR exchange rate'
      });
      
      return defaultRate;
    }
    
    return parseFloat(setting.value);
  } catch (error) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR, 
      'Failed to get exchange rate'
    );
  }
};

/**
 * Update exchange rate
 * @param {number} newRate - New exchange rate
 * @returns {Promise<number>} Updated exchange rate
 */
const updateExchangeRate = async (newRate) => {
  try {
    if (typeof newRate !== 'number' || newRate <= 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Exchange rate must be a positive number'
      );
    }
    
    // Update or create the setting
    const setting = await Setting.findOneAndUpdate(
      { key: 'usd_to_idr' },
      {
        key: 'usd_to_idr',
        value: newRate,
        description: 'USD to IDR exchange rate'
      },
      { upsert: true, new: true }
    );
    
    return parseFloat(setting.value);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to update exchange rate'
    );
  }
};

/**
 * Get system setting by key
 * @param {string} key - Setting key
 * @returns {Promise<*>} Setting value
 */
const getSettingByKey = async (key) => {
  try {
    const setting = await Setting.findOne({ key });
    
    if (!setting) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        `Setting with key "${key}" not found`
      );
    }
    
    return setting.value;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to get setting: ${key}`
    );
  }
};

/**
 * Update system setting
 * @param {string} key - Setting key
 * @param {*} value - Setting value
 * @param {string} description - Setting description
 * @returns {Promise<Object>} Updated setting
 */
const updateSetting = async (key, value, description) => {
  try {
    const setting = await Setting.findOneAndUpdate(
      { key },
      { key, value, description },
      { upsert: true, new: true }
    );
    
    return {
      key: setting.key,
      value: setting.value,
      description: setting.description
    };
  } catch (error) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to update setting: ${key}`
    );
  }
};

module.exports = {
  getExchangeRate,
  updateExchangeRate,
  getSettingByKey,
  updateSetting
};