import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from './cloudinary.js';

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'studyhelp/library',
    resource_type: 'raw',
    allowed_formats: ['pdf'],
    use_filename: true,
    unique_filename: true,
    type: 'upload',
    // Force inline delivery — prevents download prompt
    flags: 'attachment:false',
  },
});

export const pdfUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

