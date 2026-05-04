import User from '../models/User.js';
import Class from '../models/Class.js';
import Submission from '../models/Submission.js';

export const getStudents = async (req, res) => {
    try {
        const { classId } = req.query;
        if (classId) {
            const classData = await Class.findOne({ _id: classId, teacherId: req.user._id })
                .populate('students', 'name email schoolName phone');
            return res.status(200).json({ success: true, students: classData?.students || [] });
        }

        // Fallback: all students who have joined any of the teacher's classes
        const classes = await Class.find({ teacherId: req.user._id });
        const studentIds = [...new Set(classes.flatMap(c => c.students))];
        const students = await User.find({ _id: { $in: studentIds } }, 'name email schoolName');

        res.status(200).json({ success: true, students });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getStudentPerformance = async (req, res) => {
    try {
        const { id } = req.params;
        const teacherId = req.user._id;

        // BOLA Check: Verify teacher has access to this student
        const hasAccess = await Class.exists({
            teacherId: teacherId,
            students: id
        });

        if (!hasAccess && String(teacherId) !== String(id)) {
            return res.status(403).json({ success: false, message: 'Access denied to this student performance' });
        }

        const submissions = await Submission.find({ studentId: id })
            .populate('examId', 'title')
            .sort({ createdAt: -1 });

        const totalSubmissions = submissions.length;
        const avgScore = submissions.reduce((sum, s) => sum + s.score, 0) / (totalSubmissions || 1);

        res.status(200).json({
            success: true,
            performance: {
                totalSubmissions,
                avgScore,
                history: submissions
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
