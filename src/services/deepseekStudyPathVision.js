import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import aiClient from '../utils/aiClient.js';
import { STUDY_PATH_VISION_MODEL } from '../config/studyPathConfig.js';

/** Render selected one-based PDF pages to JPEGs for DeepSeek's image input. */
export async function renderPdfPagesToImages(buffer, pageNumbers, { maxDimension = 1400, quality = 72 } = {}) {
  // pdfjs-dist relies on browser geometry globals; napi-rs/canvas supplies the
  // native implementations required by its Node renderer.
  globalThis.DOMMatrix = DOMMatrix;
  globalThis.ImageData ||= ImageData;
  globalThis.Path2D ||= Path2D;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buffer), disableWorker: true, isEvalSupported: false,
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
    verbosity: pdfjs.VerbosityLevel.ERRORS
  }).promise;
  try {
    const images = [];
    for (const pageNumber of [...new Set(pageNumbers.map(Number))].sort((a, b) => a - b)) {
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
        throw new Error(`Cannot render invalid PDF page ${pageNumber}.`);
      }
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(1.6, maxDimension / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      await page.render({ canvasContext: context, viewport }).promise;
      const data = canvas.toBuffer('image/jpeg', quality).toString('base64');
      images.push({ page: pageNumber, mimeType: 'image/jpeg', data });
      page.cleanup();
    }
    return images;
  } finally {
    await pdf.destroy();
  }
}

export async function generateDeepSeekVisionJson({ prompt, images, maxTokens = 8192 }) {
  if (!Array.isArray(images) || images.length === 0) throw new Error('No PDF page images were provided to DeepSeek.');
  const content = [{ type: 'text', text: `${prompt}\n\nReturn only valid JSON. Do not use markdown fences.` }];
  for (const image of images) {
    content.push({
      type: 'text', text: `Original PDF page ${image.page}:`
    }, {
      type: 'image_url', image_url: {
        url: `data:${image.mimeType};base64,${image.data}`,
        detail: 'original'
      }
    });
  }
  const response = await aiClient.chatCompletion({
    model: STUDY_PATH_VISION_MODEL,
    messages: [{ role: 'user', content }],
    max_tokens: maxTokens,
    temperature: 0.2,
    response_format: { type: 'json_object' }
  });
  const raw = response.choices?.[0]?.message?.content;
  if (!raw || typeof raw !== 'string') throw new Error('DeepSeek returned an empty study path response.');
  try { return JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()); }
  catch { throw new Error('DeepSeek returned invalid JSON for the study path.'); }
}
