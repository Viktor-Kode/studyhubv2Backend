import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.MONGODB_URI;
console.log('Connecting to:', uri.replace(/:[^:@]+@/, ':***@'));

mongoose.connect(uri)
    .then(() => {
        console.log('✅ Connected!');
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Connection failed:', err.message);
        process.exit(1);
    });
