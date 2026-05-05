import { createRequire } from 'module';

// Add this before your pdf parsing code 
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {};
}

const require = createRequire(import.meta.url);

export const parsePdfBuffer = async (buffer) => {
  try {
    const pdfParse = require('pdf-parse');
    
    let text = '';
    let numpages = 0;

    // Check for v1 API (callable function)
    const fn = typeof pdfParse === 'function' ? pdfParse : pdfParse.default;
    if (typeof fn === 'function') {
      const data = await fn(buffer);
      text = data?.text || '';
      numpages = data?.numpages || 0;
    } 
    // Check for v2 API (PDFParse class)
    else if (pdfParse.PDFParse) {
      const parser = new pdfParse.PDFParse({ data: buffer });
      const result = await parser.getText();
      text = result?.text || '';
      numpages = result?.numpages || 0;
    } else {
      throw new Error('pdf-parse did not export a callable function or PDFParse class');
    }

    return { text, numpages };
  } catch (err) {
    console.error('[parsePdfBuffer] Failed:', err.message);
    throw new Error(`PDF parsing failed: ${err.message}`);
  }
};
