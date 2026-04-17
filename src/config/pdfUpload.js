import multer from 'multer';
import cloudinaryStorage from 'multer-storage-cloudinary';
import cloudinary from './cloudinary.js';
const storage = cloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: 'studyhelp-library',
    resource_type: 'raw', // store as raw so URLs are stable and work for any file type
    public_id: `${Date.now()}-${(file.originalname || 'doc').replace(/\s+/g, '-')}`,
    access_mode: 'public',
  }),
});

export const pdfUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/jpg',
    ]);

    if (allowedMimeTypes.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Use PDF, Word, PPT, TXT/MD, or images.'));
    }
  },
});

