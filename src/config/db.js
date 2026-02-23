import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI;

    if (!mongoURI) {
      console.error('❌ Error: MONGODB_URI or MONGO_URI is missing in environment variables.');
      process.exit(1);
    }

    const conn = await mongoose.connect(mongoURI);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    // Check for common connection errors
    if (error.message.includes('ECONNREFUSED')) {
      console.error('💡 Tip: Your backend is trying to connect to a local MongoDB. Ensure your cloud MongoDB URI is correctly set in Render.');
    }
    process.exit(1);
  }
};

export default connectDB;
