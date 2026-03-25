import mongoose from 'mongoose';

const groupChatMessageSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
    sender: { type: String, required: true, index: true }, // firebase UID
    senderName: { type: String, required: true },
    senderAvatar: { type: String, default: null },

    content: { type: String, required: true, maxlength: 1000 },
    readBy: [{ type: String, index: true }], // firebase UIDs
  },
  { timestamps: true }
);

groupChatMessageSchema.index({ group: 1, createdAt: 1 });

export default mongoose.models.GroupChatMessage ||
  mongoose.model('GroupChatMessage', groupChatMessageSchema);

