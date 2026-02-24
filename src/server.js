import { getEnv } from './config/env.js'; // Must be first to load environment variables
import app from './app.js';
import connectDB from './config/db.js';
import mongoose from 'mongoose';

// Connect to Database
connectDB();

const PORT = getEnv('PORT', 5000);


const server = app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});

// GRACEFUL SHUTDOWN
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log('📚 MongoDB connection closed.');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT received. Shutting down gracefully...');
  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log('📚 MongoDB connection closed.');
      process.exit(0);
    });
  });
});
