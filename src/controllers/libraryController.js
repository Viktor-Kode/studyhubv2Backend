import LibraryMaterial from '../models/LibraryMaterial.js';
import cloudinary from '../config/cloudinary.js';
import User from '../models/User.js';
import { hasActivePaidStudentPlan } from '../utils/studentSubscription.js';
import { PDFParse } from 'pdf-parse';
import LibraryDocument from '../models/LibraryDocument.js';
import ReadingProgress from '../models/ReadingProgress.js';

const FREE_LIMIT_MB = 50;
const PAID_LIMIT_MB = 500;
const FREE_DOCUMENT_LIMIT = 2;

// GET /api/library
export const getMaterials = async (req, res) => {
  try {
    const { folder, subject, examType, search, favourite } = req.query;
    const userId = req.user._id;

    const query = { userId };

    if (folder && folder !== 'All') query.folder = folder;
    if (subject) query.subject = new RegExp(subject, 'i');
    if (examType && examType !== 'All') query.examType = examType;
    if (favourite === 'true') query.isFavourite = true;
    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [
        { title: regex },
        { subject: regex },
        { tags: { $in: [regex] } },
      ];
    }

    const materials = await LibraryMaterial.find(query)
      .sort({ updatedAt: -1 })
      .lean();

    const totalBytes = materials.reduce((sum, m) => sum + (m.fileSize || 0), 0);
    const user = await User.findById(userId);
    const isPaid = hasActivePaidStudentPlan(user);
    const limitMB = isPaid ? PAID_LIMIT_MB : FREE_LIMIT_MB;

    const folders = [...new Set(materials.map((m) => m.folder))];

    res.json({
      success: true,
      materials,
      folders,
      storage: {
        usedBytes: totalBytes,
        usedMB: (totalBytes / (1024 * 1024)).toFixed(1),
        limitMB,
        percentage: Math.round((totalBytes / (limitMB * 1024 * 1024)) * 100),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/library/upload
export const uploadMaterial = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const {
      title,
      description,
      subject,
      topic,
      folder,
      tags,
      examType,
      color,
    } = req.body;

    const userId = req.user._id;
    const user = await User.findById(userId);
    const isPaid = hasActivePaidStudentPlan(user);
    const limitBytes = (isPaid ? PAID_LIMIT_MB : FREE_LIMIT_MB) * 1024 * 1024;

    const existingMaterials = await LibraryMaterial.find({ userId });
    const usedBytes = existingMaterials.reduce((sum, m) => sum + (m.fileSize || 0), 0);

    if (usedBytes + req.file.size > limitBytes) {
      // Remove uploaded file from Cloudinary since we can't keep it
      if (req.file.filename) {
        await cloudinary.uploader.destroy(req.file.filename, { resource_type: 'image' });
      }
      return res.status(403).json({
        success: false,
        error: `Storage limit reached. ${isPaid ? '500MB' : '50MB'} limit.`,
        showUpgrade: !isPaid,
      });
    }

    const fileUrl = req.file.path.endsWith('.pdf')
      ? req.file.path
      : `${req.file.path}.pdf`;

    const material = await LibraryMaterial.create({
      userId,
      title: title || req.file.originalname.replace(/\.pdf$/i, ''),
      description: description || '',
      subject: subject || '',
      topic: topic || '',
      folder: folder || 'General',
      tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      examType: examType || 'Other',
      color: color || '#4F46E5',
      fileUrl,
      publicId: req.file.filename,
      fileSize: req.file.size,
    });

    res.json({ success: true, material });
  } catch (err) {
    console.error('[Library] Upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// PUT /api/library/:id
export const updateMaterial = async (req, res) => {
  try {
    const {
      title,
      description,
      subject,
      topic,
      folder,
      tags,
      examType,
      color,
      isFavourite,
      lastReadPage,
      readProgress,
    } = req.body;

    const updates = {
      updatedAt: new Date(),
    };

    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (subject !== undefined) updates.subject = subject;
    if (topic !== undefined) updates.topic = topic;
    if (folder !== undefined) updates.folder = folder;
    if (examType !== undefined) updates.examType = examType;
    if (color !== undefined) updates.color = color;
    if (typeof isFavourite === 'boolean') updates.isFavourite = isFavourite;
    if (lastReadPage !== undefined) updates.lastReadPage = lastReadPage;
    if (readProgress !== undefined) updates.readProgress = readProgress;
    if (tags !== undefined) {
      updates.tags = Array.isArray(tags)
        ? tags
        : tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
    }

    const material = await LibraryMaterial.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: updates },
      { new: true }
    );

    if (!material) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, material });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// DELETE /api/library/:id
export const deleteMaterial = async (req, res) => {
  try {
    const material = await LibraryMaterial.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!material) return res.status(404).json({ success: false, error: 'Not found' });

    if (material.publicId) {
      await cloudinary.uploader.destroy(material.publicId, { resource_type: 'image' });
    }

    await LibraryMaterial.findByIdAndDelete(material._id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// PUT /api/library/:id/progress
export const saveProgress = async (req, res) => {
  try {
    const { lastReadPage, readProgress } = req.body;

    await LibraryMaterial.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      {
        $set: {
          lastReadPage,
          readProgress,
          updatedAt: new Date(),
        },
      }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/library/folder
export const manageFolder = async (req, res) => {
  try {
    const { oldName, newName } = req.body;

    if (oldName && newName) {
      await LibraryMaterial.updateMany(
        { userId: req.user._id, folder: oldName },
        { $set: { folder: newName } }
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

const clampPercentage = (value) => {
  const numeric = Number(value) || 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const getPdfPagesFromUrl = async (fileUrl) => {
  try {
    const response = await fetch(fileUrl);
    if (!response.ok) return 0;
    const buffer = Buffer.from(await response.arrayBuffer());
    const parser = new PDFParse({ data: buffer });
    try {
      const info = await parser.getInfo();
      if (typeof info?.total === 'number') {
        return info.total;
      }
      const text = await parser.getText();
      return text?.numpages || 0;
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    console.error('[Library] Failed to parse PDF pages:', error.message);
    return 0;
  }
};

// GET /api/library/documents
export const listDocuments = async (req, res) => {
  try {
    const userId = String(req.user._id);

    const [documents, progressRows] = await Promise.all([
      LibraryDocument.find({ userId }).sort({ updatedAt: -1 }).lean(),
      ReadingProgress.find({ userId }).sort({ lastReadAt: -1 }).lean(),
    ]);

    const progressMap = new Map(
      progressRows.map((progress) => [String(progress.documentId), progress])
    );

    const items = documents.map((document) => {
      const progress = progressMap.get(String(document._id));
      return {
        ...document,
        progress: progress
          ? {
              currentPage: progress.currentPage,
              percentage: progress.percentage,
              lastReadAt: progress.lastReadAt,
            }
          : {
              currentPage: 1,
              percentage: 0,
              lastReadAt: null,
            },
      };
    });

    items.sort((a, b) => {
      const aTime = a.progress.lastReadAt
        ? new Date(a.progress.lastReadAt).getTime()
        : new Date(a.updatedAt).getTime();
      const bTime = b.progress.lastReadAt
        ? new Date(b.progress.lastReadAt).getTime()
        : new Date(b.updatedAt).getTime();
      return bTime - aTime;
    });

    res.json({ success: true, documents: items });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// POST /api/library/documents
export const createDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const userId = String(req.user._id);
    const { title, subject, coverColor } = req.body;
    const user = await User.findById(userId).lean();
    const isPaid = hasActivePaidStudentPlan(user);

    if (!isPaid) {
      const currentCount = await LibraryDocument.countDocuments({ userId });
      if (currentCount >= FREE_DOCUMENT_LIMIT) {
        return res.status(403).json({
          success: false,
          error: `Free users can only keep ${FREE_DOCUMENT_LIMIT} documents. Upgrade to store more.`,
          showUpgrade: true,
          code: 'library_limit',
        });
      }
    }

    const fileUrl = req.file.path;
    const isPdf = (req.file.mimetype || '').toLowerCase() === 'application/pdf';
    const pages = isPdf ? await getPdfPagesFromUrl(fileUrl) : 0;
    const originalName = req.file.originalname || '';

    const document = await LibraryDocument.create({
      userId,
      title: title || originalName.replace(/\.[^/.]+$/i, ''),
      subject: subject || '',
      fileUrl,
      fileSize: req.file.size,
      fileType: req.file.mimetype || 'application/pdf',
      coverColor: coverColor || '#5B4CF5',
      pages,
      publicId: req.file.filename,
      originalName,
    });

    res.status(201).json({ success: true, document });
  } catch (error) {
    console.error('[Library] Document upload error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/library/documents/:id
export const getDocumentById = async (req, res) => {
  try {
    const userId = String(req.user._id);
    const document = await LibraryDocument.findOne({ _id: req.params.id, userId }).lean();
    if (!document) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    const progress = await ReadingProgress.findOne({
      userId,
      documentId: document._id,
    }).lean();

    res.json({
      success: true,
      document: {
        ...document,
        progress: progress
          ? {
              currentPage: progress.currentPage,
              percentage: progress.percentage,
              lastReadAt: progress.lastReadAt,
            }
          : { currentPage: 1, percentage: 0, lastReadAt: null },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// DELETE /api/library/documents/:id
export const deleteDocument = async (req, res) => {
  try {
    const userId = String(req.user._id);
    const document = await LibraryDocument.findOne({ _id: req.params.id, userId });
    if (!document) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    if (document.publicId) {
      await cloudinary.uploader.destroy(document.publicId, { resource_type: 'raw' });
    }

    await Promise.all([
      LibraryDocument.findByIdAndDelete(document._id),
      ReadingProgress.deleteMany({ userId, documentId: document._id }),
    ]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/library/progress/:documentId
export const getProgress = async (req, res) => {
  try {
    const userId = String(req.user._id);
    const progress = await ReadingProgress.findOne({
      userId,
      documentId: req.params.documentId,
    }).lean();

    res.json({
      success: true,
      progress: progress
        ? {
            currentPage: progress.currentPage,
            percentage: progress.percentage,
            lastReadAt: progress.lastReadAt,
          }
        : {
            currentPage: 1,
            percentage: 0,
            lastReadAt: null,
          },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// POST /api/library/progress
export const upsertProgress = async (req, res) => {
  try {
    const userId = String(req.user._id);
    const { documentId, currentPage, percentage } = req.body;

    if (!documentId) {
      return res.status(400).json({ success: false, error: 'documentId is required' });
    }

    const progress = await ReadingProgress.findOneAndUpdate(
      { userId, documentId },
      {
        $set: {
          currentPage: Math.max(1, Number(currentPage) || 1),
          percentage: clampPercentage(percentage),
          lastReadAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({ success: true, progress });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Stream PDF for LibraryDocument or legacy LibraryMaterial (same Cloudinary fetch logic as route).
 */
export const proxyLibraryPdf = async (req, res) => {
  try {
    const id = req.params.id;
    const userIdStr = String(req.user._id);

    let fileUrl;
    let publicId;

    const doc = await LibraryDocument.findOne({ _id: id, userId: userIdStr }).lean();
    if (doc) {
      fileUrl = doc.fileUrl;
      publicId = doc.publicId;
    } else {
      const legacy = await LibraryMaterial.findOne({
        _id: id,
        userId: req.user._id,
      }).lean();
      if (legacy) {
        fileUrl = legacy.fileUrl;
        publicId = legacy.publicId;
      }
    }

    if (!fileUrl) {
      return res.status(404).json({ error: 'Not found' });
    }

    let response = await fetch(fileUrl);

    if (!response.ok && fileUrl.includes('/raw/upload/')) {
      const altUrl = fileUrl.replace('/raw/upload/', '/image/upload/');
      response = await fetch(altUrl);
    }

    if (!response.ok && fileUrl.includes('/image/upload/')) {
      const altUrl = fileUrl.replace('/image/upload/', '/raw/upload/');
      response = await fetch(altUrl);
    }

    if (!response.ok && publicId) {
      try {
        const signedUrl = cloudinary.url(publicId, {
          resource_type: 'raw',
          secure: true,
          sign_url: true,
        });
        response = await fetch(signedUrl);
      } catch (signErr) {
        console.error('[PDF Proxy] Signed URL failed:', signErr.message);
      }
    }

    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({
          error: 'PDF file not found on Cloudinary (404)',
        });
      }
      return res.status(502).json({
        error: `Cloudinary returned ${response.status}`,
      });
    }

    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[PDF Proxy] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Stream any library file for LibraryDocument or legacy LibraryMaterial.
 */
export const proxyLibraryFile = async (req, res) => {
  try {
    const id = req.params.id;
    const userIdStr = String(req.user._id);

    let fileUrl;
    let publicId;

    const doc = await LibraryDocument.findOne({ _id: id, userId: userIdStr }).lean();
    if (doc) {
      fileUrl = doc.fileUrl;
      publicId = doc.publicId;
    } else {
      const legacy = await LibraryMaterial.findOne({
        _id: id,
        userId: req.user._id,
      }).lean();
      if (legacy) {
        fileUrl = legacy.fileUrl;
        publicId = legacy.publicId;
      }
    }

    if (!fileUrl) {
      return res.status(404).json({ error: 'Not found' });
    }

    let response = await fetch(fileUrl);

    if (!response.ok && fileUrl.includes('/raw/upload/')) {
      const altUrl = fileUrl.replace('/raw/upload/', '/image/upload/');
      response = await fetch(altUrl);
    }

    if (!response.ok && fileUrl.includes('/image/upload/')) {
      const altUrl = fileUrl.replace('/image/upload/', '/raw/upload/');
      response = await fetch(altUrl);
    }

    if (!response.ok && publicId) {
      try {
        const signedUrl = cloudinary.url(publicId, {
          resource_type: 'raw',
          secure: true,
          sign_url: true,
        });
        response = await fetch(signedUrl);
      } catch (signErr) {
        console.error('[File Proxy] Signed URL failed:', signErr.message);
      }
    }

    if (!response.ok) {
      return res.status(502).json({ error: `Cloudinary returned ${response.status}` });
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[File Proxy] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/library/documents/:id
export const updateDocument = async (req, res) => {
  try {
    const userId = String(req.user._id);
    const { title, subject, coverColor } = req.body;
    const updates = { updatedAt: new Date() };

    if (title !== undefined && String(title).trim()) updates.title = String(title).trim();
    if (subject !== undefined) updates.subject = String(subject).trim();
    if (coverColor !== undefined && String(coverColor).trim()) {
      updates.coverColor = String(coverColor).trim();
    }

    const document = await LibraryDocument.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: updates },
      { new: true }
    );

    if (!document) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    res.json({ success: true, document });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/library/recent
export const getRecentDocuments = async (req, res) => {
  try {
    const userId = String(req.user._id);
    const recent = await ReadingProgress.find({ userId })
      .sort({ lastReadAt: -1 })
      .limit(10)
      .populate('documentId')
      .lean();

    const documents = recent
      .filter((entry) => entry.documentId)
      .map((entry) => ({
        ...entry.documentId,
        progress: {
          currentPage: entry.currentPage,
          percentage: entry.percentage,
          lastReadAt: entry.lastReadAt,
        },
      }));

    res.json({ success: true, documents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

