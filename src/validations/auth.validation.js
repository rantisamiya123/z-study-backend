const Joi = require('joi');
const { password } = require('./custom.validation');

/**
 * Validasi untuk registrasi user
 */
const register = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    name: Joi.string().required()
  })
};

/**
 * Validasi untuk login user
 */
const login = {
  body: Joi.object().keys({
    email: Joi.string().required(),
    password: Joi.string().required()
  })
};

/**
 * Validasi untuk refresh token
 */
const refreshToken = {
  body: Joi.object().keys({
    refreshToken: Joi.string().required()
  })
};

/**
 * Validasi untuk forgot password
 */
const forgotPassword = {
  body: Joi.object().keys({
    email: Joi.string().required().email()
  })
};

/**
 * Validasi untuk reset password
 */
const resetPassword = {
  query: Joi.object().keys({
    token: Joi.string().required()
  }),
  body: Joi.object().keys({
    password: Joi.string().required().custom(password)
  })
};

/**
 * Validasi untuk change password
 */
const changePassword = {
  body: Joi.object().keys({
    oldPassword: Joi.string().required(),
    newPassword: Joi.string().required().custom(password)
  })
};

/**
 * Validasi untuk verifikasi email
 */
const verifyEmail = {
  query: Joi.object().keys({
    token: Joi.string().required()
  })
};

module.exports = {
  register,
  login,
  refreshToken,
  forgotPassword,
  resetPassword,
  changePassword,
  verifyEmail
};
