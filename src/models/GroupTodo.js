import mongoose from 'mongoose';

const groupTodoSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },

    title: { type: String, required: true, maxlength: 140 },
    description: { type: String, default: '', maxlength: 400 },

    completed: { type: Boolean, default: false, index: true },
    assignedTo: { type: String, default: null, index: true }, // firebase UID

    createdBy: { type: String, required: true, index: true }, // firebase UID
    dueDate: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

groupTodoSchema.index({ group: 1, dueDate: 1, completed: 1 });

export default mongoose.models.GroupTodo || mongoose.model('GroupTodo', groupTodoSchema);

