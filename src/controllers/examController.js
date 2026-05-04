import Exam from '../models/Exam.js';
import Submission from '../models/Submission.js';

export const getExams = async (req, res) => {
    try {
        const { classId } = req.query;
        const filter = { teacherId: req.user._id };
        if (classId) filter.classId = classId;

        const exams = await Exam.find(filter).sort({ createdAt: -1 });
        res.status(200).json({ success: true, exams });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const createExam = async (req, res) => {
    try {
        const exam = await Exam.create({
            ...req.body,
            teacherId: req.user._id
        });
        res.status(201).json({ success: true, exam });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

export const getExam = async (req, res) => {
    try {
        const exam = await Exam.findOne({ _id: req.params.id, teacherId: req.user._id })
            .populate('questions');
        if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
        res.status(200).json({ success: true, exam });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateExam = async (req, res) => {
    try {
        const exam = await Exam.findOneAndUpdate(
            { _id: req.params.id, teacherId: req.user._id },
            req.body,
            { new: true }
        );
        if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
        res.status(200).json({ success: true, exam });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

export const deleteExam = async (req, res) => {
    try {
        const exam = await Exam.findOneAndDelete({ _id: req.params.id, teacherId: req.user._id });
        if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
        res.status(200).json({ success: true, message: 'Exam deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const publishExam = async (req, res) => {
    try {
        const exam = await Exam.findOneAndUpdate(
            { _id: req.params.id, teacherId: req.user._id },
            { status: 'active', openDate: new Date() },
            { new: true }
        );
        if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
        res.status(200).json({ success: true, exam });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

export const closeExam = async (req, res) => {
    try {
        const exam = await Exam.findOneAndUpdate(
            { _id: req.params.id, teacherId: req.user._id },
            { status: 'closed', closeDate: new Date() },
            { new: true }
        );
        if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
        res.status(200).json({ success: true, exam });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

export const getExamSubmissions = async (req, res) => {
    try {
        const { id } = req.params;
        const teacherId = req.user._id;

        // BOLA Check: Verify teacher owns the exam
        const exam = await Exam.findOne({ _id: id, teacherId });
        if (!exam) {
            return res.status(403).json({ success: false, message: 'Access denied to these submissions' });
        }

        const submissions = await Submission.find({ examId: id })
            .populate('studentId', 'name email');
        res.status(200).json({ success: true, submissions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
