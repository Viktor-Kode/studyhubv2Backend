import mammoth from 'mammoth';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

export const parseFile = async (filePath, mimetype) => {
    try {
        if (mimetype === 'application/pdf') {
            const buffer = fs.readFileSync(filePath);
            const data = await pdfParse(buffer);
            return data.text;
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
