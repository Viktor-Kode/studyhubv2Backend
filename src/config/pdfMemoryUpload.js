import multer from 'multer';

const storage = multer.memoryStorage();

export const pdfMemoryUpload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // Slightly increased to 25MB
  fileFilter: (req, file, cb) => {
    const mimetype = file.mimetype.toLowerCase();
    const originalname = file.originalname.toLowerCase();
    
    const isPdf = mimetype === 'application/pdf' || originalname.endsWith('.pdf') || mimetype === 'application/x-pdf';
    const isDoc = mimetype.includes('word') || originalname.endsWith('.docx') || originalname.endsWith('.doc');
    const isPpt = mimetype.includes('presentation') || mimetype.includes('powerpoint') || originalname.endsWith('.pptx') || originalname.endsWith('.ppt');
    const isText = mimetype.includes('text') || originalname.endsWith('.txt') || originalname.endsWith('.md');
    const isImage = mimetype.startsWith('image/');

    if (isPdf || isDoc || isPpt || isText || isImage) {
      cb(null, true);
    } else {
      // Be lenient on mobile if mimetype is generic
      if (mimetype === 'application/octet-stream' || !mimetype) {
        cb(null, true);
      } else {
        cb(new Error(`File type ${mimetype} not supported. Please use PDF, Word, or Text files.`));
      }
    }
  },
});
