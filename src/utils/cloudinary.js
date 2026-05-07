import cloudinary from '../config/cloudinary.js';

/**
 * Uploads a buffer to Cloudinary and returns the result.
 */
export const uploadToCloudinary = (buffer, filename) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'studyhelp-library',
        resource_type: 'raw',
        public_id: `${Date.now()}-${(filename || 'doc').replace(/\s+/g, '-')}`,
        access_mode: 'public',
        access_control: [{ access_type: 'anonymous' }],
      },
      (error, result) => {
        if (error) {
          console.error('[Cloudinary Utils] Upload failed:', error);
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    uploadStream.end(buffer);
  });
};
