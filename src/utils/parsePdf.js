import PDFParser from 'pdf2json';

/**
 * PDF text extraction using pdf2json.
 * Avoids all CommonJS/ESM import issues that plagued pdf-parse.
 */
const extractTextFromPDF = (buffer) => {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    pdfParser.on('pdfParser_dataReady', (pdfData) => {
      const text = pdfData.Pages
        .map(page =>
          page.Texts
            .map(t => decodeURIComponent(t.R[0].T))
            .join(' ')
        )
        .join('\n');
      resolve(text);
    });

    pdfParser.on('pdfParser_dataError', (err) => {
      reject(new Error(err.parserError));
    });

    pdfParser.parseBuffer(buffer);
  });
};

/**
 * Exported wrapper — matches the existing parsePdfBuffer signature.
 */
export const parsePdfBuffer = async (buffer) => {
  try {
    if (!Buffer.isBuffer(buffer)) {
      throw new Error('Input must be a Buffer');
    }

    if (buffer.slice(0, 4).toString() !== '%PDF') {
      throw new Error('File is not a valid PDF (missing %PDF header)');
    }

    const text = await extractTextFromPDF(buffer);

    return {
      text: text || '',
      numpages: 0   // pdf2json doesn't expose a simple page count; 0 is a safe default
    };
  } catch (err) {
    console.error('[parsePdfBuffer] Failed:', err.message);
    throw new Error(`PDF parsing failed: ${err.message}`);
  }
};
