import mongoose from 'mongoose';

const StudyGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 60 },
    description: { type: String, maxlength: 300 },
    subject: { type: String },
    coverColor: { type: String, default: '#5B4CF5' },
    visibility: { type: String, enum: ['public', 'private'], default: 'public' },
    joinCode: { type: String, unique: true, sparse: true },
    creatorId: { type: String, required: true },
    creatorName: { type: String, required: true },
    members: [
      {
        userId: String,
        name: String,
        avatar: String,
        role: { type: String, enum: ['admin', 'member'], default: 'member' },
        joinedAt: { type: Date, default: Date.now },
        points: { type: Number, default: 0 },
      },
    ],
    membersCount: { type: Number, default: 1 },
    messagesCount: { type: Number, default: 0 },
    lastActivity: { type: Date, default: Date.now },
    isPinned: { type: Boolean, default: false },
    lastRead: {
      type: [
        {
          userId: { type: String },
          lastReadAt: { type: Date },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

const StudyGroup = mongoose.model('StudyGroup', StudyGroupSchema);
export default StudyGroup;
