import mongoose from 'mongoose';

const universitySchema = new mongoose.Schema({
  name: { type: String, required: true },
  shortName: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  logo: { type: String, default: null },
  location: { type: String },
  type: {
    type: String,
    enum: ['federal', 'state', 'private'],
    default: 'federal'
  },
  availableSubjects: [String],
  availableYears: [Number],
  totalQuestions: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

universitySchema.index({ slug: 1 }, { unique: true });
universitySchema.index({ isActive: 1, type: 1 });

const University = mongoose.model('University', universitySchema);
export default University;
