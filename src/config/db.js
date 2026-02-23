import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI;

    if (!mongoURI) {
      console.error('❌ Error: MONGODB_URI or MONGO_URI is missing in environment variables.');
      process.exit(1);
    }

    // Identify if the URI looks like a local one
    const isLocal = mongoURI.includes('localhost') || mongoURI.includes('127.0.0.1');

    // Mask the URI for safe logging (e.g., mongodb+srv://user:***@cluster.mongodb.net)
    const maskedURI = mongoURI.replace(/:([^:@]{3,})@/, ':***@');
    console.log(`🔌 Attempting to connect to: ${maskedURI.substring(0, 40)}...`);

    if (isLocal && process.env.NODE_ENV === 'production') {
      console.warn('⚠️ WARNING: Using a LOCALHOST MongoDB URI in a PRODUCTION environment!');
    }

    const conn = await mongoose.connect(mongoURI);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);

    if (error.message.includes('ECONNREFUSED')) {
      const currentURI = process.env.MONGODB_URI || process.env.MONGO_URI;
      const hostType = (currentURI?.includes('localhost') || currentURI?.includes('127.0.0.1')) ? 'LOCALHOST' : 'REMOTE HOST';
      console.error(`💡 Tip: Your backend tried to connect to a ${hostType}.`);
      console.error('Check your Render Dashboard settings. If you set MONGODB_URI there, ensure it does not have trailing spaces.');
    }
    process.exit(1);
  }
};

export default connectDB;
