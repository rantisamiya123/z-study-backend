const express = require('express');
const authRoute = require('./auth.routes');
const userRoute = require('./user.routes');
const llmRoute = require('./llm.routes');
const topupRoute = require('./topup.routes');
const adminRoute = require('./admin.routes');
const conversationRoute = require('./conversation.routes');
const chatRoute = require('./chat.routes');
// const config = require('../config/environment');

const router = express.Router();

const routes = [
  {
    path: '/auth',
    route: authRoute,
  },
  {
    path: '/user',
    route: userRoute,
  },
  {
    path: '/llm',
    route: llmRoute,
  },
  {
    path: '/conversations',
    route: conversationRoute,
  },
    {
    path: '/chat',
    route: chatRoute,
  },
  {
    path: '/topup',
    route: topupRoute,
  },
  {
    path: '/admin',
    route: adminRoute,
  },
];

// Register all routes
routes.forEach((route) => {
  router.use(route.path, route.route);
});

// Health check route
// router.get('/health', (req, res) => {
//   res.status(200).send({
//     status: 'ok',
//     timestamp: new Date().toISOString(),
//     version: config.env.APP_VERSION || '1.0.0'
//   });
// });

module.exports = router;
