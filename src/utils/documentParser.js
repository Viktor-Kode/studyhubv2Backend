import { createRequire } from 'module';
import { parsePdfBuffer } from './parsePdf.js';
import mammoth from 'mammoth';
import textract from 'textract';
import officeParser from 'officeparser';

const require = createRequire(import.meta.url);

/**
 * Universal document parser for the backend.
 * Supports PDF, DOCX, PPTX, TXT, and Images.
 */
export const parseDocumentBuffer = async (buffer, originalname, mimetype) => {
  const extension = originalname?.split('.').pop()?.toLowerCase();
  const mime = mimetype?.toLowerCase();

  try {
    // 1. PDF
    if (extension === 'pdf' || mime === 'application/pdf' || mime === 'application/x-pdf') {
      return await parsePdfBuffer(buffer);
    }

    // 2. DOCX
    if (extension === 'docx' || mime?.includes('wordprocessingml')) {
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value, numpages: 1 };
    }

    // 3. PPTX / PPT / Other Office
    if (extension === 'pptx' || extension === 'ppt' || mime?.includes('presentationml') || mime?.includes('powerpoint')) {
      return new Promise((resolve, reject) => {
        textract.fromBufferWithMime(mime || 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer, (error, text) => {
          if (error) {
            console.error('[parseDocumentBuffer] textract failed for PPT:', error.message);
            // Fallback to officeparser if textract fails
            officeParser.parseUndefined(buffer, (data, err) => {
              if (err) reject(err);
              else resolve({ text: data, numpages: 1 });
            });
          } else {
            resolve({ text, numpages: 1 });
          }
        });
      });
    }

    // 4. Images (via textract/tesseract if available, or just skip if no OCR)
    if (mime?.startsWith('image/')) {
       return new Promise((resolve) => {
        textract.fromBufferWithMime(mime, buffer, (error, text) => {
          if (error) {
            console.warn('[parseDocumentBuffer] textract failed for image (likely no Tesseract):', error.message);
            resolve({ text: '', numpages: 1 });
          } else {
            resolve({ text, numpages: 1 });
          }
        });
      });
    }

    // 5. TXT / MD
    if (extension === 'txt' || extension === 'md' || mime?.startsWith('text/')) {
      return { text: buffer.toString('utf8'), numpages: 1 };
    }

    // Default Fallback: officeparser
    return new Promise((resolve, reject) => {
      officeParser.parseUndefined(buffer, (data, err) => {
        if (err) {
          // Final fallback: try to stringify if it's small
          if (buffer.length < 50000) {
            resolve({ text: buffer.toString('utf8'), numpages: 1 });
          } else {
            reject(err);
          }
        }
        else resolve({ text: data, numpages: 1 });
      });
    });
  } catch (err) {
    console.error('[parseDocumentBuffer] General error:', err.message);
    throw new Error(`Unsupported or unreadable document format: ${extension || mime}`);
  }
};
