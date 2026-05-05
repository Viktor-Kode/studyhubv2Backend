/**
 * Polyfill for DOMMatrix and DOMRect.
 * Required for pdfjs-dist v5+ in Node.js environments.
 */
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() {
      this.a = 1; this.b = 0;
      this.c = 0; this.d = 1;
      this.e = 0; this.f = 0;
    }
  };
}

if (typeof globalThis.DOMRect === 'undefined') {
  globalThis.DOMRect = class DOMRect {
    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x; this.y = y;
      this.width = width;
      this.height = height;
    }
  };
}

import { createRequire } from 'module';

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
