import admin from 'firebase-admin';
import { getEnv } from './env.js';

if (!admin.apps.length) {
    const serviceAccountJson = getEnv('FIREBASE_SERVICE_ACCOUNT');
    const projectId = getEnv('FIREBASE_PROJECT_ID') || 'studyhelp-82734';

    try {
        if (serviceAccountJson) {
            // If provided as a JSON string (typical for Render/Heroku)
            const serviceAccount = JSON.parse(serviceAccountJson);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                projectId
            });
            console.log('✅ Firebase Admin initialized with Service Account Cert');
        } else {
            // Fallback for local dev / Google Cloud environment
            admin.initializeApp({
                projectId
            });
            console.log(`ℹ️ Firebase Admin initialized with Project ID: ${projectId} (No Service Account Cert)`);
        }
    } catch (error) {
        console.error('❌ Failed to initialize Firebase Admin:', error.message);
        // We don't exit(1) here to allow the app to boot even if auth is broken, 
        // but protected routes will fail.
    }
}

const adminAuth = admin.auth();
export { adminAuth };
export default admin;

