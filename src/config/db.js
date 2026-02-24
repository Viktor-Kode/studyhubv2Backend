import mongoose from 'mongoose';
import { getEnv } from './env.js';

const connectDB = async () => {
  try {
    const mongoURI = getEnv('MONGODB_URI') || getEnv('MONGO_URI');

    if (!mongoURI) {
      console.error('❌ Error: MONGODB_URI or MONGO_URI is missing in environment variables.');
      process.exit(1);
    }


    // Identify if the URI looks like a local one
    const isLocal = mongoURI.includes('localhost') || mongoURI.includes('127.0.0.1');

    // Mask the URI for safe logging
    const maskedURI = mongoURI.replace(/:([^:@]{3,})@/, ':***@');

    if (isLocal && (getEnv('NODE_ENV') === 'production' || !!process.env.RENDER)) {
      console.error('❌ CRITICAL ERROR: Connection to LOCALHOST is not allowed in PRODUCTION.');
      console.error('Current MONGODB_URI starts with:', mongoURI.substring(0, 20));
      console.error('Please check your Render dashboard and update MONGODB_URI with your Atlas connection string.');
      process.exit(1);
    }

    console.log(`🔌 Attempting to connect to: ${maskedURI.substring(0, 50)}...`);

    const conn = await mongoose.connect(mongoURI);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);

    if (error.message.includes('ECONNREFUSED')) {
      const currentURI = getEnv('MONGODB_URI') || getEnv('MONGO_URI');
      const hostType = (currentURI?.includes('localhost') || currentURI?.includes('127.0.0.1')) ? 'LOCALHOST' : 'REMOTE HOST';
      console.error(`💡 Tip: Your backend tried to connect to a ${hostType}.`);

      console.error('Check your Render Dashboard settings. If you set MONGODB_URI there, ensure it does not have trailing spaces.');
    }
    process.exit(1);
  }
};

export default connectDB;
