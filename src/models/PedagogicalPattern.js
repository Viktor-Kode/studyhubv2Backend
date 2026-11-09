import mongoose from 'mongoose';

const conceptPairSchema = new mongoose.Schema({
  source: { type: String, required: true },
  target: { type: String, required: true },
  relationship: { type: String, default: 'relates_to' }
}, { _id: false });

const distractorPatternSchema = new mongoose.Schema({
  concept: { type: String, required: true },
  distractor: { type: String, required: true },
  selectionCount: { type: Number, default: 1 }
}, { _id: false });

const pedagogicalPatternSchema = new mongoose.Schema({
  discipline: {
    type: String,
    required: true,
    index: true,
    enum: ['medicine', 'stem', 'law', 'business', 'humanities', 'general']
  },
  topicKey: {
    type: String,
    required: true,
    index: true
  },
  conceptPairs: [conceptPairSchema],
  commonPitfalls: [{ type: String }],
  vettedAnalogies: [{ type: String }],
  effectiveDistractors: [distractorPatternSchema],
  usageCount: { type: Number, default: 1 }
}, { timestamps: true });

pedagogicalPatternSchema.index({ discipline: 1, topicKey: 1 }, { unique: true });

export default mongoose.model('PedagogicalPattern', pedagogicalPatternSchema);
