import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import aiClient from '../utils/aiClient.js';
import { STUDY_PATH_VISION_MODEL } from '../config/studyPathConfig.js';

// In-memory cache for rendered slide images to avoid redundant CPU-heavy canvas renders
const inMemoryPageCache = new Map();
const SLIDE_CACHE_DIR = path.resolve(process.cwd(), 'uploads', 'slide-cache');

if (!fs.existsSync(SLIDE_CACHE_DIR)) {
  try {
    fs.mkdirSync(SLIDE_CACHE_DIR, { recursive: true });
  } catch (_) {}
}

/**
 * Fast buffer key computation for caching rendered slide images.
 */
function getBufferFingerprint(buffer, topicId = null) {
  if (topicId) return topicId;
  return crypto.createHash('md5').update(buffer.slice(0, Math.min(buffer.length, 16384))).digest('hex').slice(0, 12);
}

/** Render selected one-based PDF pages to JPEGs for DeepSeek's image input with memory and disk caching. */
export async function renderPdfPagesToImages(buffer, pageNumbers, { maxDimension = 900, quality = 65, topicId = null } = {}) {
  const uniquePages = [...new Set(pageNumbers.map(Number))].sort((a, b) => a - b);
  if (uniquePages.length === 0) return [];

  const bufferKey = getBufferFingerprint(buffer, topicId);
  const results = new Map();
  const pagesToRender = [];

  // 1. Check in-memory cache and disk cache first
  for (const pageNumber of uniquePages) {
    const memKey = `${bufferKey}_p${pageNumber}_${maxDimension}`;
    if (inMemoryPageCache.has(memKey)) {
      results.set(pageNumber, { page: pageNumber, mimeType: 'image/jpeg', data: inMemoryPageCache.get(memKey) });
      continue;
    }

    // Check disk cache
    const diskPath = path.join(SLIDE_CACHE_DIR, `${bufferKey}_p${pageNumber}.jpg`);
    if (fs.existsSync(diskPath)) {
      try {
        const diskData = fs.readFileSync(diskPath).toString('base64');
        inMemoryPageCache.set(memKey, diskData);
        results.set(pageNumber, { page: pageNumber, mimeType: 'image/jpeg', data: diskData });
        continue;
      } catch (_) {}
    }

    pagesToRender.push(pageNumber);
  }

  // If all requested pages were already cached, return immediately (0ms canvas time!)
  if (pagesToRender.length === 0) {
    return uniquePages.map((p) => results.get(p));
  }

  // 2. Render remaining pages in parallel using pdfjs and native canvas
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
    await Promise.all(pagesToRender.map(async (pageNumber) => {
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
        throw new Error(`Cannot render invalid PDF page ${pageNumber}.`);
      }
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(1.2, maxDimension / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      await page.render({ canvasContext: context, viewport }).promise;
      const rawJpegBuffer = canvas.toBuffer('image/jpeg', quality);
      const data = rawJpegBuffer.toString('base64');

      // Populate memory cache
      const memKey = `${bufferKey}_p${pageNumber}_${maxDimension}`;
      inMemoryPageCache.set(memKey, data);

      // Asynchronously persist to disk cache
      const diskPath = path.join(SLIDE_CACHE_DIR, `${bufferKey}_p${pageNumber}.jpg`);
      fs.promises.writeFile(diskPath, rawJpegBuffer).catch(() => {});

      results.set(pageNumber, { page: pageNumber, mimeType: 'image/jpeg', data });
      page.cleanup();
    }));

    return uniquePages.map((p) => results.get(p));
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
        detail: 'auto'
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
