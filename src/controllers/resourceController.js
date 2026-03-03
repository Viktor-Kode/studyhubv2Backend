import Resource from '../models/Resource.js';
import { createRequire } from 'module';
import mammoth from 'mammoth';
import officeparser from 'officeparser';
import aiClient from '../utils/aiClient.js';
import Question from '../models/Question.js';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

export const uploadResource = async (req, res) => {
    try {
        const { title, classId } = req.body;
        const file = req.file;

        if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        let extractedText = '';
        const fileExtension = file.originalname.split('.').pop().toLowerCase();

        if (fileExtension === 'pdf') {
            const data = await pdf(file.buffer);
            extractedText = data.text;
        } else if (fileExtension === 'docx') {
            const data = await mammoth.extractRawText({ buffer: file.buffer });
            extractedText = data.value;
        } else if (['pptx', 'xlsx', 'docx'].includes(fileExtension)) {
            // officeparser for PPTX and others
            extractedText = await new Promise((resolve, reject) => {
                officeparser.parseBinary(file.buffer, (data, err) => {
                    if (err) reject(err);
                    else resolve(data);
                });
            });
        } else if (['txt', 'md'].includes(fileExtension)) {
            extractedText = file.buffer.toString('utf-8');
        } else {
            return res.status(400).json({ success: false, message: 'Unsupported file type' });
        }

        if (extractedText.trim().length < 100) {
            return res.status(400).json({ success: false, message: 'Only text-based documents supported' });
        }

        const resource = await Resource.create({
            teacherId: req.user._id,
            classId,
            title,
            fileType: fileExtension,
            extractedText
        });

        res.status(201).json({ success: true, resource });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getResources = async (req, res) => {
    try {
        const { classId } = req.query;
        const resources = await Resource.find({ classId, teacherId: req.user._id });
        res.status(200).json({ success: true, resources });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const deleteResource = async (req, res) => {
    try {
        const resource = await Resource.findOneAndDelete({ _id: req.params.id, teacherId: req.user._id });
        if (!resource) return res.status(404).json({ success: false, message: 'Resource not found' });
        res.status(200).json({ success: true, message: 'Resource deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const generateQuestionsFromResource = async (req, res) => {
    try {
        const resource = await Resource.findById(req.params.id);
        if (!resource) return res.status(404).json({ success: false, message: 'Resource not found' });

        const prompt = `Based on the following text, generate 5 objective questions. 
    Text: ${resource.extractedText.substring(0, 4000)}
    Return JSON array: [{ question, options, correctAnswer, totalMarks }]`;

        const response = await aiClient.generateChatResponse([
            { role: 'user', content: prompt }
        ]);

        const jsonString = response.replace(/```json|```/g, '').trim();
        const questions = JSON.parse(jsonString);

        const savedQuestions = await Question.insertMany(
            questions.map(q => ({
                ...q,
                teacherId: req.user._id,
                classId: resource.classId,
                subject: 'Extracted',
                type: 'obj',
                source: 'AI'
            }))
        );

        res.status(200).json({ success: true, questions: savedQuestions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const generateFlashcardsFromResource = async (req, res) => {
    try {
        const resource = await Resource.findById(req.params.id);
        if (!resource) return res.status(404).json({ success: false, message: 'Resource not found' });

        const prompt = `Generate 10 flashcards (front/back) from this text: 
    ${resource.extractedText.substring(0, 4000)}
    Return JSON array: [{ "front": "", "back": "" }]`;

        const response = await aiClient.generateChatResponse([
            { role: 'user', content: prompt }
        ]);

        const jsonString = response.replace(/```json|```/g, '').trim();
        const flashcards = JSON.parse(jsonString);

        resource.flashcards = flashcards;
        await resource.save();

        res.status(200).json({ success: true, flashcards });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const generateSummaryFromResource = async (req, res) => {
    try {
        const resource = await Resource.findById(req.params.id);
        if (!resource) return res.status(404).json({ success: false, message: 'Resource not found' });

        const prompt = `Summarize the following text into key bullet points and a concluding paragraph:
    ${resource.extractedText.substring(0, 4000)}`;

        const summary = await aiClient.generateChatResponse([
            { role: 'user', content: prompt }
        ]);

        resource.summary = summary;
        await resource.save();

        res.status(200).json({ success: true, summary });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
