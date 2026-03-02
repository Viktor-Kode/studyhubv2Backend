import admin from 'firebase-admin';
import { getEnv } from './env.js';

let adminAuth;

if (!admin.apps.length) {
    const serviceAccountJson = getEnv('FIREBASE_SERVICE_ACCOUNT');
    const projectId = getEnv('FIREBASE_PROJECT_ID') || 'studyhelp-82734';

    try {
        if (serviceAccountJson) {
            const serviceAccount = JSON.parse(serviceAccountJson);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                projectId
            });
            console.log('✅ Firebase Admin initialized with Service Account Cert');
        } else {
            admin.initializeApp({
                projectId
            });
            console.log(`ℹ️ Firebase Admin initialized with Project ID: ${projectId} (No Service Account Cert)`);
        }
        adminAuth = admin.auth();
    } catch (error) {
        console.error('❌ Failed to initialize Firebase Admin:', error.message);
        // Fallback or dummy object to prevent total crash on import
        adminAuth = {
            verifyIdToken: () => { throw new Error('Firebase Auth not initialized'); }
        };
    }
} else {
    adminAuth = admin.auth();
}

export { adminAuth };
export default admin;

