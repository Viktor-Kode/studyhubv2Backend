import mongoose from 'mongoose';

const TransactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reference: { type: String, required: true, unique: true },
    amount: { type: Number, required: true }, // NGN (same units as Flutterwave charge)
    plan: { type: String, enum: ['weekly', 'monthly', 'addon'], required: true },
    status: {
        type: String,
        enum: ['pending', 'success', 'failed'],
        default: 'pending'
    },
    processed: { type: Boolean, default: false }, // prevent double activation
    processedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
});

TransactionSchema.index({ reference: 1 }, { unique: true });

const Transaction = mongoose.model('Transaction', TransactionSchema);
export default Transaction;
