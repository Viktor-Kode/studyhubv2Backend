import { getEnv } from './config/env.js'; // Must be first to load environment variables
import app from './app.js';
import connectDB from './config/db.js';
import mongoose from 'mongoose';
import { registerNotificationJobs } from './jobs/notificationJobs.js';
import { registerPushNotificationCrons } from './jobs/pushNotificationCron.js';
import './jobs/subscriptionJobs.js';
import './jobs/streakJobs.js';
import './jobs/reminderJobs.js';

// Connect to Database
connectDB().then(() => {
  registerNotificationJobs();
  registerPushNotificationCrons();
});

const PORT = Number(getEnv('PORT', 5000));
const HOST = '0.0.0.0';


const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 Server started on http://${HOST}:${PORT}`);
});

// Increase timeouts for large file processing and uploads
server.timeout = 120000; // 120 seconds
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;


// GRACEFUL SHUTDOWN
process.on('SIGTERM', async () => {
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  try {
    server.close();
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during SIGTERM shutdown:', err);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  console.log('👋 SIGINT received. Shutting down gracefully...');
  try {
    server.close();
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during SIGINT shutdown:', err);
    process.exit(1);
  }
});
