const express = require('express');
const passport = require('passport');
const authController = require('../controllers/auth.controller');
// const { validate } = require('../middleware/validation.middleware');
// const authValidation = require('../validations/auth.validation');
const auth = require('../middleware/auth.middleware');

const router = express.Router();

// Register new user
router.post(
  '/register',
  // validate(authValidation.register),
  authController.register
);

// Login user
router.post(
  '/login',
  // validate(authValidation.login),
  authController.login
);

// Google OAuth routes
// router.get(
//   '/google',
//   passport.authenticate('google', { scope: ['profile', 'email'] })
// );

// router.get(
//   '/google/callback',
//   passport.authenticate('google', { session: false, failureRedirect: '/login' }),
//   // authController.googleAuthCallback
// );

// Refresh token
router.post(
  '/refresh',
  // validate(authValidation.refreshToken),
  authController.refreshToken
);

// Verify token and get user info
router.get(
  '/verify',
  auth(),
  authController.verifyToken
);

// Logout (revoke token)
router.post(
  '/logout',
  auth(),
  authController.logout
);

module.exports = router;
