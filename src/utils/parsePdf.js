import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export const parsePdfBuffer = async (buffer) => {
  const pdfLib = require('pdf-parse');
  
  if (typeof pdfLib === 'function') {
    // Legacy support for pdf-parse v1
    const data = await pdfLib(buffer);
    return {
      text: data?.text || '',
      numpages: data?.numpages || 0
    };
  } else if (pdfLib.PDFParse) {
    // Support for pdf-parse v2+
    const parser = new pdfLib.PDFParse({ data: buffer });
    const doc = await parser.load();
    const numpages = doc?.numPages || 0;
    const parsed = await parser.getText();
    return {
      text: parsed?.text || '',
      numpages
    };
  }
  
  throw new Error('Unsupported pdf-parse module structure');
};
