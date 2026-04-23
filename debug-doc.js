import mongoose from 'mongoose';
import './src/config/env.js';
import LibraryDocument from './src/models/LibraryDocument.js';
import LibraryMaterial from './src/models/LibraryMaterial.js';

async function check() {
  const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoURI) {
    console.error('No MONGODB_URI found in process.env');
    process.exit(1);
  }
  
  await mongoose.connect(mongoURI);
  console.log('✅ Connected to MongoDB');

  const id = '69da0709446dcb571529fa85';

  console.log(`\n--- Searching for ID: ${id} ---`);

  try {
    const doc = await LibraryDocument.findById(id).lean();
    if (doc) {
      console.log('Found in LibraryDocument:');
      console.log(JSON.stringify(doc, null, 2));
    } else {
      console.log('Not found in LibraryDocument');
    }

    const legacy = await LibraryMaterial.findById(id).lean();
    if (legacy) {
      console.log('Found in LibraryMaterial:');
      console.log(JSON.stringify(legacy, null, 2));
    } else {
      console.log('Not found in LibraryMaterial');
    }
  } catch (err) {
    console.error('Error during search:', err.message);
  }

  process.exit(0);
}

check().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
