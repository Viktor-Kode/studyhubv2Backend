import { createRequire } from 'module';
import { parsePdfBuffer } from './parsePdf.js';
import mammoth from 'mammoth';
import officeParser from 'officeparser';

const require = createRequire(import.meta.url);

/**
 * Universal document parser for the backend.
 * Supports PDF, DOCX, PPTX, TXT.
 */
export const parseDocumentBuffer = async (buffer, originalname, mimetype) => {
  const extension = originalname?.split('.').pop()?.toLowerCase();
  const mime = mimetype?.toLowerCase();

  // 1. PDF
  if (extension === 'pdf' || mime === 'application/pdf' || mime === 'application/x-pdf') {
    return await parsePdfBuffer(buffer);
  }

  // 2. DOCX
  if (extension === 'docx' || mime?.includes('wordprocessingml')) {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value, numpages: 1 };
  }

  // 3. TXT / MD
  if (extension === 'txt' || extension === 'md' || mime?.startsWith('text/')) {
    return { text: buffer.toString('utf8'), numpages: 1 };
  }

  // 4. Other Office Formats (PPTX, XLSX, etc.) via officeparser
  try {
    const text = await new Promise((resolve, reject) => {
      officeParser.parseUndefined(buffer, (data, err) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
    return { text, numpages: 1 };
  } catch (err) {
    console.error('[parseDocumentBuffer] OfficeParser failed:', err.message);
    // Fallback to simple string if all else fails and it looks like text
    if (mime?.startsWith('text/') || buffer.length < 50000) {
       return { text: buffer.toString('utf8'), numpages: 1 };
    }
    throw new Error(`Unsupported or unreadable document format: ${extension || mime}`);
  }
};
