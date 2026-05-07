import { parsePdfBuffer } from './parsePdf.js';
import mammoth from 'mammoth';

/**
 * Simplified document parser for the backend.
 * Focuses on PDF and DOCX, with robust error handling.
 */
export const parseDocumentBuffer = async (buffer, originalname, mimetype) => {
  const extension = originalname?.split('.').pop()?.toLowerCase();
  const mime = mimetype?.toLowerCase();

  try {
    // 1. PDF (Priority)
    if (extension === 'pdf' || mime?.includes('pdf')) {
      return await parsePdfBuffer(buffer);
    }

    // 2. DOCX
    if (extension === 'docx' || mime?.includes('wordprocessingml')) {
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      return { text: result.value, numpages: 1 };
    }

    // 3. TXT / MD
    if (extension === 'txt' || extension === 'md' || mime?.startsWith('text/')) {
      return { text: buffer.toString('utf8'), numpages: 1 };
    }

    // Fallback for everything else: Try to treat as text if small, or error out
    if (buffer.length < 100000) {
      return { text: buffer.toString('utf8'), numpages: 1 };
    }

    throw new Error('Unsupported file format');
  } catch (err) {
    console.error('[parseDocumentBuffer] Error:', err.message);
    throw err;
  }
};
