import mammoth from 'mammoth';
import fs from 'fs';
import { parsePdfBuffer } from './parsePdf.js';

export const parseFile = async (filePath, mimetype) => {
    try {
        if (mimetype === 'application/pdf') {
            const buffer = fs.readFileSync(filePath);
            const parsed = await parsePdfBuffer(buffer);
            return parsed.text;
        }

        if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            mimetype === 'application/msword') {
            const result = await mammoth.extractRawText({ path: filePath });
            return result.value;
        }

        if (mimetype === 'text/plain') {
            return fs.readFileSync(filePath, 'utf-8');
        }

        throw new Error('Unsupported file type');
    } catch (err) {
        throw new Error('Failed to parse file: ' + err.message);
    }
};
