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

/**
 * Single-pass PDF Document Intelligence Service.
 * Extracts text, per-page word counts, visual slide tags, prominent headers,
 * and page-delimited rawText without redundant parser traversals.
 */
export async function analyzePdfDocument(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Input must be a valid Buffer.');
  }

  if (buffer.slice(0, 4).toString() !== '%PDF') {
    throw new Error('File is not a valid PDF (missing %PDF header).');
  }

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
    const totalPages = document.numPages;
    const pages = [];
    const detectedHeadings = [];
    let totalWordCount = 0;
    const visualPages = [];
    const densePages = [];

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items || [];

      // Extract raw strings while identifying candidate titles from initial items
      const textChunks = [];
      let candidateHeader = '';

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const str = (item && 'str' in item) ? String(item.str).trim() : '';
        if (str) {
          textChunks.push(str);
          // First non-trivial item often acts as the slide or section title
          if (!candidateHeader && str.length >= 3 && str.length <= 80 && !/^\d+$/.test(str)) {
            candidateHeader = str;
          }
        }
      }

      const pageText = textChunks.join(' ').replace(/\s+/g, ' ').trim();
      const words = pageText ? pageText.split(/\s+/).filter(Boolean) : [];
      const wordCount = words.length;
      totalWordCount += wordCount;

      const isVisual = !pageText || wordCount < 15;
      if (isVisual) visualPages.push(pageNumber);
      else densePages.push(pageNumber);

      if (candidateHeader) {
        detectedHeadings.push({
          page: pageNumber,
          title: candidateHeader
        });
      }

      pages.push({
        page: pageNumber,
        text: pageText,
        groundingText: pageText,
        wordCount,
        visual: isVisual
      });

      page.cleanup();
    }

    const rawText = pages
      .map((p) => `--- Page ${p.page} ---\n${p.text}`)
      .join('\n\n');

    const documentProfile = {
      totalPages,
      totalWordCount,
      visualPageCount: visualPages.length,
      densePageCount: densePages.length,
      visualPages,
      densePages,
      detectedHeadings: detectedHeadings.slice(0, 30),
      analyzedAt: new Date()
    };

    return {
      totalPages,
      pages,
      rawText,
      inventory: pages,
      documentProfile
    };
  } finally {
    await document.destroy();
  }
}
