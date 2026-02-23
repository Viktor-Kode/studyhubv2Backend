import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || 'studyhelp-82734'
    });
}

const adminAuth = admin.auth();
export { adminAuth };
export default admin;
