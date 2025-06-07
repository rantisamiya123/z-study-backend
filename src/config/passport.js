const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { env } = require('./environment');
const User = require('../models/user.model');

const jwtOptions = {
  secretOrKey: env.JWT_SECRET,
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken()
};

const jwtVerify = async (payload, done) => {
  try {
    if (payload.exp < Date.now() / 1000) {
      return done(null, false, { message: 'Token expired' });
    }

    const user = await User.findById(payload.sub);
    
    if (!user) {
      return done(null, false, { message: 'User not found' });
    }

    if (user.status === 'banned') {
      return done(null, false, { message: 'Account banned' });
    }

    done(null, user);
  } catch (error) {
    done(error, false);
  }
};

const jwtStrategy = new JwtStrategy(jwtOptions, jwtVerify);

// Google OAuth strategy configuration
const googleOptions = {
  clientID: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  callbackURL: env.GOOGLE_CALLBACK_URL
};

const googleVerify = async (accessToken, refreshToken, profile, done) => {
  try {
    // Find or create user
    let user = await User.findOne({ googleId: profile.id });
    
    if (!user) {
      // Create new user if not found
      user = await User.create({
        googleId: profile.id,
        email: profile.emails[0].value,
        name: profile.displayName || `${profile.name.givenName} ${profile.name.familyName}`,
      });
    }

    if (user.status === 'banned') {
      return done(null, false, { message: 'Account banned' });
    }

    done(null, user);
  } catch (error) {
    done(error, false);
  }
};

const googleStrategy = new GoogleStrategy(googleOptions, googleVerify);

module.exports = {
  jwtStrategy,
  googleStrategy
};
