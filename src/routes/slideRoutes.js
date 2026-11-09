import express from 'express';
import fs from 'fs';
import path from 'path';
import { getPdfBuffer } from '../services/studyPathNodeService.js';
import { renderPdfPagesToImages } from '../services/deepseekStudyPathVision.js';
import StudyPath from '../models/StudyPath.js';

const router = express.Router();
const SLIDE_CACHE_DIR = path.resolve(process.cwd(), 'uploads', 'slide-cache');

if (!fs.existsSync(SLIDE_CACHE_DIR)) {
  try {
    fs.mkdirSync(SLIDE_CACHE_DIR, { recursive: true });
  } catch (err) {
    console.warn('[slideRoutes] Failed to create slide cache directory:', err.message);
  }
}

/**
 * GET /api/slides/:documentId/page-:page.png
 * GET /api/slides/:documentId/page-:page.jpg
 * Returns the rendered page slide image for a given study path document.
 */
router.get('/:documentId/page-:page.:ext', async (req, res) => {
  try {
    const { documentId, page } = req.params;
    const pageNumber = parseInt(page, 10);

    if (isNaN(pageNumber) || pageNumber < 1) {
      return res.status(400).json({ success: false, message: 'Invalid page number' });
    }

    const cachedFilePath = path.join(SLIDE_CACHE_DIR, `${documentId}_p${pageNumber}.jpg`);

    // 1. Serve from disk cache if already rendered
    if (fs.existsSync(cachedFilePath)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      return res.sendFile(cachedFilePath);
    }

    // 2. Locate PDF buffer from memory or storage path
    let buffer = await getPdfBuffer(documentId);
    if (!buffer) {
      // Check if documentId is a topicId in MongoDB
      const studyPath = await StudyPath.findOne({ topicId: documentId }, { pdfStoragePath: 1 }).lean();
      if (studyPath?.pdfStoragePath) {
        buffer = await getPdfBuffer(documentId, studyPath.pdfStoragePath);
      }
    }

    if (!buffer) {
      return res.status(404).json({ success: false, message: 'Source PDF not found for this document' });
    }

    // 3. Render slide image
    const images = await renderPdfPagesToImages(buffer, [pageNumber], { maxDimension: 1200, quality: 75 });
    if (!images || images.length === 0 || !images[0]?.data) {
      return res.status(404).json({ success: false, message: `Could not render page ${pageNumber}` });
    }

    const imageBuffer = Buffer.from(images[0].data, 'base64');

    // Asynchronously save to disk cache
    fs.promises.writeFile(cachedFilePath, imageBuffer).catch((err) => {
      console.warn('[slideRoutes] Failed to cache slide image to disk:', err.message);
    });

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    return res.status(200).send(imageBuffer);
  } catch (error) {
    console.error('[slideRoutes] Error serving slide image:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to generate slide preview' });
  }
});

export default router;
