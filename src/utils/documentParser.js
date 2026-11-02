import { parsePdfBuffer } from './parsePdf.js';
import mammoth from 'mammoth';
import { parseOffice } from 'officeparser';

/**
 * Simplified document parser for the backend.
 * Focuses on PDF, DOCX, PPTX/PPT, and TXT, with robust error handling.
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

    // 3. PPTX / PPT
    if (extension === 'pptx' || extension === 'ppt' || mime?.includes('powerpoint') || mime?.includes('presentationml')) {
      const text = await parseOffice(buffer);
      return { text: text || '', numpages: 1 };
    }

    // 4. TXT / MD
    if (extension === 'txt' || extension === 'md' || mime?.startsWith('text/')) {
      return { text: buffer.toString('utf8'), numpages: 1 };
    }

    // Fallback attempt with officeparser for other office formats
    try {
      const text = await parseOffice(buffer);
      if (text && text.trim().length > 0) {
        return { text, numpages: 1 };
      }
    } catch {
      // Continue to text fallback
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
