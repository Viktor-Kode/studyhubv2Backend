import './config/env.js'; // Must be first to load environment variables
import app from './app.js';
import connectDB from './config/db.js';

// Connect to Database
connectDB();

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});