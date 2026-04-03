import Class from '../models/Class.js';
import User from '../models/User.js';

export const getClasses = async (req, res) => {
    try {
        let classes;
        if (req.user.role === 'teacher') {
            classes = await Class.find({ teacherId: req.user._id });
        } else if (req.user.role === 'student') {
            classes = await Class.find({ students: req.user._id });
        } else {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        res.status(200).json({ success: true, classes });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const createClass = async (req, res) => {
    try {
        const newClass = await Class.create({
            ...req.body,
            teacherId: req.user._id
        });
        res.status(201).json({ success: true, class: newClass });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

export const getClass = async (req, res) => {
    try {
        const classData = await Class.findOne({ _id: req.params.id, teacherId: req.user._id })
            .populate('students', 'name email');
        if (!classData) return res.status(404).json({ success: false, message: 'Class not found' });
        res.status(200).json({ success: true, class: classData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateClass = async (req, res) => {
    try {
        const updatedClass = await Class.findOneAndUpdate(
            { _id: req.params.id, teacherId: req.user._id },
            req.body,
            { new: true, runValidators: true }
        );
        if (!updatedClass) return res.status(404).json({ success: false, message: 'Class not found' });
        res.status(200).json({ success: true, class: updatedClass });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

export const deleteClass = async (req, res) => {
    try {
        const deletedClass = await Class.findOneAndDelete({ _id: req.params.id, teacherId: req.user._id });
        if (!deletedClass) return res.status(404).json({ success: false, message: 'Class not found' });
        res.status(200).json({ success: true, message: 'Class deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const joinClass = async (req, res) => {
    try {
        const { joinCode } = req.body;
        const classToJoin = await Class.findOne({ joinCode });
        if (!classToJoin) return res.status(404).json({ success: false, message: 'Invalid join code' });

        if (classToJoin.students.includes(req.user._id)) {
            return res.status(400).json({ success: false, message: 'Already joined this class' });
        }

        classToJoin.students.push(req.user._id);
        await classToJoin.save();

        res.status(200).json({ success: true, message: 'Joined class successfully', class: classToJoin });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getClassStudents = async (req, res) => {
    try {
        const classData = await Class.findOne({ _id: req.params.id, teacherId: req.user._id })
            .populate('students', 'name email schoolName');
        if (!classData) return res.status(404).json({ success: false, message: 'Class not found' });
        res.status(200).json({ success: true, students: classData.students });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
