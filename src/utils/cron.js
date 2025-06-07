const cron = require('node-cron');
const tokenService = require('../services/token.service');

/**
 * Cron job untuk membersihkan token yang sudah kadaluarsa
 * Dijalankan setiap hari pada pukul 00:00
 */
const purgeExpiredTokens = cron.schedule('0 0 * * *', async () => {
  console.log('Running cron job: Purging expired tokens');
  try {
    await tokenService.purgeExpiredTokens();
    console.log('Expired tokens purged successfully');
  } catch (error) {
    console.error('Error purging expired tokens:', error);
  }
}, {
  scheduled: false, // Perlu diaktifkan secara manual
});

/**
 * Memulai semua cron jobs
 */
const start = () => {
  purgeExpiredTokens.start();
  console.log('All cron jobs started');
};

/**
 * Menghentikan semua cron jobs
 */
const stop = () => {
  purgeExpiredTokens.stop();
  console.log('All cron jobs stopped');
};

module.exports = {
  start,
  stop,
};