import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// pdf-parse is a CommonJS-only module — must be loaded via require() in an ESM context
const pdfParseLib = require('pdf-parse');
const pdfParse = typeof pdfParseLib === 'function' ? pdfParseLib : pdfParseLib.default;

/**
 * Robust PDF text extraction using pdf-parse.
 */
export const parsePdfBuffer = async (buffer) => {
  try {
    // 1. Verify it's a real PDF buffer
    if (!Buffer.isBuffer(buffer)) {
      throw new Error('Input must be a Buffer');
    }

    if (buffer.slice(0, 4).toString() !== '%PDF') {
      throw new Error('File is not a valid PDF (missing %PDF header)');
    }

    // 2. Parse using the direct function
    const data = await pdfParse(buffer);
    
    return {
      text: data?.text || '',
      numpages: data?.numpages || 0
    };
  } catch (err) {
    console.error('[parsePdfBuffer] Failed:', err.message);
    throw new Error(`PDF parsing failed: ${err.message}`);
  }
};
