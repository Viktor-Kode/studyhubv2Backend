import pdfParseLib from 'pdf-parse';

// Handle different export patterns (ESM vs CommonJS)
const pdfParse = typeof pdfParseLib === 'function' ? pdfParseLib : (pdfParseLib.default || pdfParseLib);

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
