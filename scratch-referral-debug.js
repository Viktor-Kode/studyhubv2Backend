import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from './src/models/User.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
dotenv.config({ path: path.join(__dirname, '.env') });

const run = async () => {
    const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoURI) {
        console.error('❌ MONGODB_URI is not set in .env');
        process.exit(1);
    }

    console.log('🔌 Connecting to database...');
    await mongoose.connect(mongoURI);
    console.log('✅ Connected!');

    console.log('\n--- 1. Users with referralCode ---');
    const usersWithCodes = await User.find({ referralCode: { $ne: null } }).select('name email referralCode referralCount aiCredits referredBy referrals');
    console.log(usersWithCodes);

    console.log('\n--- 2. Users who have been referred (referredBy is not null) ---');
    const referredUsers = await User.find({ referredBy: { $ne: null } }).populate('referredBy', 'name email referralCode');
    console.log(referredUsers);

    console.log('\n--- 3. Recent 5 users created ---');
    const recentUsers = await User.find().sort({ createdAt: -1 }).limit(5).select('name email firebaseUid referralCode referredBy aiCredits createdAt');
    console.log(recentUsers);

    console.log('\n🔌 Disconnecting...');
    await mongoose.disconnect();
    console.log('Done!');
};

run().catch(console.error);
