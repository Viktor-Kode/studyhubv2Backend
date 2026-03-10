import LibraryMaterial from '../models/LibraryMaterial.js';
import cloudinary from '../config/cloudinary.js';
import User from '../models/User.js';

const FREE_LIMIT_MB = 50;
const PAID_LIMIT_MB = 500;

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
    const isPaid = user?.subscriptionStatus === 'active';
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
    const isPaid = user?.subscriptionStatus === 'active';
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

