import crypto from 'node:crypto';
import mongoose from 'mongoose';
import StudyPath from '../models/StudyPath.js';
import DocumentHash from '../models/DocumentHash.js';

/**
 * Normalizes text for robust content fingerprinting.
 * Normalizes Unicode (NFKC), converts to lowercase, and collapses whitespace.
 */
export function normalizeTextForHashing(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Computes a deterministic SHA-256 hash for normalized text.
 */
export function hashText(text) {
  const normalized = normalizeTextForHashing(text);
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Computes a SHA-256 hash for a raw file buffer.
 */
export function hashBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return null;
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Computes composite document fingerprint.
 * Incorporates buffer hash, text hash, and byte size.
 */
export function computeDocumentFingerprint({ buffer, text, fileName, totalPages = 0 }) {
  const bufferHash = hashBuffer(buffer);
  const textHash = hashText(text);
  const primaryHash = textHash || bufferHash;

  return {
    contentHash: primaryHash,
    textHash,
    bufferHash,
    byteSize: buffer?.length || Buffer.byteLength(text || '', 'utf8'),
    fileName: fileName || 'document',
    totalPages: totalPages || 0
  };
}

/**
 * Checks if the same user already has an existing StudyPath with this content hash.
 * If found, returns the existing record so we can serve it immediately (<500ms).
 */
export async function findUserCachedStudyPath(userId, contentHash) {
  if (!userId || userId === 'anonymous-user' || !contentHash) {
    return null;
  }

  const existing = await StudyPath.findOne({
    userId,
    contentHash,
    isActive: true
  }).sort({ updatedAt: -1 });

  return existing;
}

/**
 * Checks if ANY user previously processed this exact document.
 * Returns the latest existing StudyPath for structural intelligence reuse
 * WITHOUT reusing private user progress, attempts, or ownership.
 */
export async function findReusableDocumentIntelligence(contentHash) {
  if (!contentHash) return null;

  const existing = await StudyPath.findOne(
    {
      contentHash,
      'nodes.0': { $exists: true }
    },
    {
      title: 1,
      courseCode: 1,
      inventory: 1,
      totalPages: 1,
      extractedText: 1,
      classification: 1,
      documentProfile: 1,
      blueprintId: 1,
      nodes: 1
    }
  ).sort({ updatedAt: -1 }).lean();

  return existing;
}

/**
 * Records or updates the DocumentHash entry with the generated studyPathId.
 */
export async function recordDocumentHash({ userId, hash, fileName, studyPathId }) {
  if (!userId || userId === 'anonymous-user' || !hash) return null;
  try {
    const isOid = mongoose.Types.ObjectId.isValid(userId);
    if (!isOid) return null;
    return await DocumentHash.findOneAndUpdate(
      { userId, hash },
      {
        $setOnInsert: { userId, hash, fileName },
        ...(studyPathId ? { $addToSet: { studyPathIds: studyPathId } } : {})
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.warn('[fingerprintService] DocumentHash record warning:', err.message);
    return null;
  }
}

