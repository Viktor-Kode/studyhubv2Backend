import PDFParser from 'pdf2json';

/**
 * PDF text extraction using pdf2json.
 * Returns { text, numpages } where numpages is the real page count.
 */
const extractTextFromPDF = (buffer) => {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    pdfParser.on('pdfParser_dataReady', (pdfData) => {
      const pages = pdfData.Pages || [];
      const text = pages
        .map(page =>
          (page.Texts || [])
            .map(t => decodeURIComponent(t.R?.[0]?.T || ''))
            .join(' ')
        )
        .join('\n');
      resolve({ text, numpages: pages.length });
    });

    pdfParser.on('pdfParser_dataError', (err) => {
      reject(new Error(err.parserError));
    });

    pdfParser.parseBuffer(buffer);
  });
};

/**
 * Exported wrapper — matches the existing parsePdfBuffer signature.
 * Returns { text, numpages }
 */
export const parsePdfBuffer = async (buffer) => {
  try {
    if (!Buffer.isBuffer(buffer)) {
      throw new Error('Input must be a Buffer');
    }

    if (buffer.slice(0, 4).toString() !== '%PDF') {
      throw new Error('File is not a valid PDF (missing %PDF header)');
    }

    const { text, numpages } = await extractTextFromPDF(buffer);

    return { text: text || '', numpages };
  } catch (err) {
    console.error('[parsePdfBuffer] Failed:', err.message);
    throw new Error(`PDF parsing failed: ${err.message}`);
  }
};
