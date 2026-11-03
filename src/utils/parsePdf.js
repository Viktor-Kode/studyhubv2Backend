import PDFParser from 'pdf2json';

class PdfTextMatrix {
  constructor(value = []) {
    const source = Array.isArray(value) ? value : [value.a, value.b, value.c, value.d, value.e, value.f];
    [this.a, this.b, this.c, this.d, this.e, this.f] = [source[0] ?? 1, source[1] ?? 0, source[2] ?? 0, source[3] ?? 1, source[4] ?? 0, source[5] ?? 0];
  }
  multiply(other) {
    return new PdfTextMatrix([
      this.a * other.a + this.c * other.b, this.b * other.a + this.d * other.b,
      this.a * other.c + this.c * other.d, this.b * other.c + this.d * other.d,
      this.a * other.e + this.c * other.f + this.e, this.b * other.e + this.d * other.f + this.f
    ]);
  }
  translate(x, y = 0) { return this.multiply(new PdfTextMatrix([1, 0, 0, 1, x, y])); }
  scale(x, y = x) { return this.multiply(new PdfTextMatrix([x, 0, 0, y, 0, 0])); }
  inverse() {
    const det = this.a * this.d - this.b * this.c;
    return new PdfTextMatrix([this.d / det, -this.b / det, -this.c / det, this.a / det, (this.c * this.f - this.d * this.e) / det, (this.b * this.e - this.a * this.f) / det]);
  }
  transformPoint(point) { return { x: point.x * this.a + point.y * this.c + this.e, y: point.x * this.b + point.y * this.d + this.f }; }
}

/** Text inventory used to distinguish dense pages from image/diagram slides. */
export const inventoryPdfPages = async (buffer) => {
  if (!globalThis.DOMMatrix) globalThis.DOMMatrix = PdfTextMatrix;
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    isEvalSupported: false,
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS
  }).promise;
  try {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ('str' in item ? item.str : '')).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const wordCount = text ? text.split(/\s+/).length : 0;
      pages.push({ page: pageNumber, text, groundingText: text, wordCount, visual: !text || wordCount < 15 });
      page.cleanup();
    }
    return { numpages: document.numPages, pages };
  } finally {
    await document.destroy();
  }
};

/**
 * PDF text extraction using pdf2json.
 * Returns { text, numpages } where numpages is the real page count.
 */
const extractTextFromPDF = (buffer) => {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    pdfParser.on('pdfParser_dataReady', (pdfData) => {
      const pages = pdfData.Pages || [];
      const pageTexts = pages
        .map((page, idx) => {
          const pageText = (page.Texts || [])
            .map(t => {
              try {
                return decodeURIComponent(t.R?.[0]?.T || '');
              } catch {
                return t.R?.[0]?.T || '';
              }
            })
            .join(' ');
          return pageText;
        });
      const text = pageTexts.map((pageText, idx) => `--- Page ${idx + 1} ---\n${pageText}`).join('\n\n');
      resolve({ text, numpages: pages.length, pages: pageTexts });
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

    const { text, numpages, pages } = await extractTextFromPDF(buffer);

    return { text: text || '', numpages, pages };
  } catch (err) {
    console.error('[parsePdfBuffer] Failed:', err.message);
    throw new Error(`PDF parsing failed: ${err.message}`);
  }
};
