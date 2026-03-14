import mongoose from 'mongoose';

const schema = new mongoose.Schema({
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    toolType: { type: String, required: true }, // scheme_of_work, marking_scheme, differentiated, comprehension, report_comments, report_sheet, teacher_diary, class_register
    title: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed },
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now }
});

schema.index({ teacherId: 1, createdAt: -1 });
schema.index({ teacherId: 1, toolType: 1 });

export default mongoose.model('TeacherSavedItem', schema);
