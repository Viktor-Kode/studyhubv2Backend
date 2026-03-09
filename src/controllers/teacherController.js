import TeacherQuestionSet from '../models/TeacherQuestionSet.js';
import { parseFile } from '../utils/fileParser.js';
import { generateTeacherQuestions } from '../services/teacherAiService.js';
import fs from 'fs';

const getTeacherId = (req) => req.user?.firebaseUid || req.user?._id?.toString();

export const generateQuestions = async (req, res) => {
    const filePath = req.file?.path;

    try {
        const {
            title,
            subject,
            classLevel,
            assessmentType,
            questionCount,
            marksPerQuestion,
            questionTypes,
            duration,
            instructions
        } = req.body;

        if (!req.file) {
            return res.status(400).json({ error: 'Please upload a document' });
        }

        if (!title || !questionCount) {
            return res.status(400).json({ error: 'Title and question count are required' });
        }

        const documentText = await parseFile(filePath, req.file.mimetype);

        if (!documentText || documentText.trim().length < 50) {
            return res.status(400).json({ error: 'Document appears to be empty or unreadable' });
        }

        const types = questionTypes
            ? questionTypes.split(',').map(t => t.trim())
            : ['mcq'];

        const questions = await generateTeacherQuestions({
            documentText: documentText.slice(0, 8000),
            questionCount: parseInt(questionCount),
            marksPerQuestion: parseFloat(marksPerQuestion) || 1,
            questionTypes: types,
            assessmentType,
            subject,
            classLevel
        });

        const totalMarks = questions.length * (parseFloat(marksPerQuestion) || 1);
        const teacherId = getTeacherId(req);

        const questionSet = await TeacherQuestionSet.create({
            teacherId,
            title,
            subject: subject || '',
            classLevel: classLevel || '',
            assessmentType: assessmentType || 'test',
            duration: parseInt(duration) || 60,
            totalMarks,
            instructions: instructions || '',
            questions,
            sourceFileName: req.file.originalname,
            status: 'draft'
        });

        if (filePath) fs.unlink(filePath, () => {});

        res.json({ success: true, questionSet });
    } catch (err) {
        if (filePath) fs.unlink(filePath, () => {});
        console.error('[Teacher] Generate error:', err);
        res.status(500).json({ error: err.message });
    }
};

export const getQuestionSets = async (req, res) => {
    try {
        const teacherId = getTeacherId(req);
        const sets = await TeacherQuestionSet.find({ teacherId })
            .sort({ createdAt: -1 })
            .select('-questions')
            .lean();

        res.json({ success: true, sets });
    } catch (err) {
        console.error('[Teacher] getQuestionSets error:', err);
        res.status(500).json({ error: err.message });
    }
};

export const getQuestionSet = async (req, res) => {
    try {
        const teacherId = getTeacherId(req);
        const set = await TeacherQuestionSet.findOne({
            _id: req.params.id,
            teacherId
        }).lean();

        if (!set) return res.status(404).json({ error: 'Not found' });

        res.json({ success: true, set });
    } catch (err) {
        console.error('[Teacher] getQuestionSet error:', err);
        res.status(500).json({ error: err.message });
    }
};

export const updateQuestionSet = async (req, res) => {
    try {
        const {
            title, subject, classLevel, assessmentType,
            duration, instructions, questions, status
        } = req.body;

        const teacherId = getTeacherId(req);
        const totalMarks = questions?.reduce((sum, q) => sum + (q.marks || 1), 0) || 0;

        const set = await TeacherQuestionSet.findOneAndUpdate(
            { _id: req.params.id, teacherId },
            {
                $set: {
                    title,
                    subject,
                    classLevel,
                    assessmentType,
                    duration,
                    instructions,
                    questions,
                    status,
                    totalMarks,
                    updatedAt: new Date()
                }
            },
            { new: true }
        );

        if (!set) return res.status(404).json({ error: 'Not found' });

        res.json({ success: true, set });
    } catch (err) {
        console.error('[Teacher] updateQuestionSet error:', err);
        res.status(500).json({ error: err.message });
    }
};

export const deleteQuestionSet = async (req, res) => {
    try {
        const teacherId = getTeacherId(req);
        await TeacherQuestionSet.findOneAndDelete({
            _id: req.params.id,
            teacherId
        });
        res.json({ success: true });
    } catch (err) {
        console.error('[Teacher] deleteQuestionSet error:', err);
        res.status(500).json({ error: err.message });
    }
};

export const getDownloadData = async (req, res) => {
    try {
        const teacherId = getTeacherId(req);
        const set = await TeacherQuestionSet.findOne({
            _id: req.params.id,
            teacherId
        }).lean();

        if (!set) return res.status(404).json({ error: 'Not found' });

        res.json({ success: true, set });
    } catch (err) {
        console.error('[Teacher] getDownloadData error:', err);
        res.status(500).json({ error: err.message });
    }
};
