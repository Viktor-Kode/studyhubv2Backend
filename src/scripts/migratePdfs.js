import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import LibraryMaterial from '../models/LibraryMaterial.js';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);

  const materials = await LibraryMaterial.find({});
  console.log(`Found ${materials.length} materials to check`);

  for (const m of materials) {
    // If URL contains /raw/upload/ it was uploaded with raw type
    if (m.fileUrl.includes('/raw/upload/')) {
      console.log(`Migrating: ${m.title}`);
      try {
        // Copy to image type in Cloudinary
        const result = await cloudinary.uploader.upload(m.fileUrl, {
          folder: 'studyhelp/library',
          resource_type: 'image',
          format: 'pdf',
          public_id: `${m.publicId}_migrated`,
          access_mode: 'public',
        });

        // Update DB record
        await LibraryMaterial.findByIdAndUpdate(m._id, {
          fileUrl: result.secure_url,
          publicId: result.public_id,
        });

        // Delete old raw version
        await cloudinary.uploader.destroy(m.publicId, { resource_type: 'raw' });

        console.log(`✓ Migrated: ${m.title}`);
      } catch (err) {
        console.error(`✗ Failed: ${m.title} —`, err.message);
      }
    }
  }

  console.log('Migration complete');
  await mongoose.connection.close();
}

run().catch((err) => {
  console.error('Migration script error:', err);
  process.exit(1);
});

