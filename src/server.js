import { getEnv } from './config/env.js'; // Must be first to load environment variables
import app from './app.js';
import connectDB from './config/db.js';
import mongoose from 'mongoose';
import { registerNotificationJobs } from './jobs/notificationJobs.js';

// Connect to Database
connectDB().then(() => {
  registerNotificationJobs();
});

const PORT = getEnv('PORT', 5000);


const server = app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});

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
