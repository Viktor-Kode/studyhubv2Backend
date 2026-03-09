import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  },
  { _id: false }
);

const chatHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    sessionId: {
      type: String,
      required: true
    },
    title: {
      type: String,
      default: 'New Chat'
    },
    subject: {
      type: String,
      default: ''
    },
    messages: [messageSchema]
  },
  {
    timestamps: true
  }
);

// Index for fast lookup of recent sessions per user
chatHistorySchema.index({ userId: 1, updatedAt: -1 });
chatHistorySchema.index({ userId: 1, sessionId: 1 }, { unique: true });

const ChatHistory = mongoose.model('ChatHistory', chatHistorySchema);

export default ChatHistory;

