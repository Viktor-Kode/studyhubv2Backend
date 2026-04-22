import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export const parsePdfBuffer = async (buffer) => {
  try {
    const pdfParse = require('pdf-parse');
    
    // pdf-parse always exports a single function — call it directly
    const fn = typeof pdfParse === 'function' 
      ? pdfParse 
      : pdfParse.default;
    
    if (typeof fn !== 'function') {
      throw new Error('pdf-parse did not export a callable function');
    }

    const data = await fn(buffer);
    return {
      text: data?.text || '',
      numpages: data?.numpages || 0,
    };
  } catch (err) {
    console.error('[parsePdfBuffer] Failed:', err.message);
    throw new Error(`PDF parsing failed: ${err.message}`);
  }
};
