import admin from 'firebase-admin';

if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;

    admin.initializeApp({
        projectId: projectId || 'studyhelp-82734'
    });

    if (!projectId && process.env.NODE_ENV === 'production') {
        console.warn('⚠️ Warning: FIREBASE_PROJECT_ID not set in production. Using fallback.');
    }
}

const adminAuth = admin.auth();
export { adminAuth };
export default admin;

