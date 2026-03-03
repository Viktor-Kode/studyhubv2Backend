import mongoose from 'mongoose';

// Auto-expires after 5 minutes (TTL index) — used for per-user rate limiting
const AIRequestLogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now, expires: 300 } // auto-delete after 5 mins
});

AIRequestLogSchema.index({ userId: 1, createdAt: 1 });

const AIRequestLog = mongoose.model('AIRequestLog', AIRequestLogSchema);
export default AIRequestLog;
