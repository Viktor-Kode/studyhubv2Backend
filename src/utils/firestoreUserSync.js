import admin from '../config/firebase-admin.js';
import User from '../models/User.js';

const VALID_ROLES = new Set(['student', 'teacher', 'admin']);
let firestoreSyncDisabled = false;

/**
 * Client writes `role` to Firestore (`users/{uid}`) on signup / role picker,
 * but MongoDB may still be `student` from auto-provision in `protect`.
 * Promote to `teacher` when Firestore says so so API route checks match the app role.
 */
export async function syncRoleFromFirestore(firebaseUid, currentUser) {
    if (!firebaseUid || !currentUser) return currentUser;
    if (currentUser.role === 'admin') return currentUser;
    if (firestoreSyncDisabled || process.env.FIRESTORE_ROLE_SYNC_ENABLED === 'false') return currentUser;

    try {
        const db = admin.firestore();
        const snap = await db.collection('users').doc(firebaseUid).get();
        if (!snap.exists) return currentUser;

        const updateData = {};

        // Role sync
        const fsRole = snap.get('role');
        if (fsRole && VALID_ROLES.has(fsRole)) {
            // Avoid accidental demotion: only promote to teacher from Firestore here.
            if (fsRole === 'teacher' && currentUser.role !== 'teacher') {
                updateData.role = 'teacher';
            }
        }

        // Institution sync
        const fsInstitution = snap.get('institution');
        if (fsInstitution && fsInstitution !== currentUser.institution) {
            updateData.institution = fsInstitution;
        }

        // SchoolName sync
        const fsSchoolName = snap.get('schoolName');
        if (fsSchoolName && fsSchoolName !== currentUser.schoolName) {
            updateData.schoolName = fsSchoolName;
        }

        // Apply updates if any
        if (Object.keys(updateData).length > 0) {
            await User.findByIdAndUpdate(currentUser._id, updateData, { runValidators: false });
            Object.assign(currentUser, updateData);
            console.log(
                `[AUTH] Synced fields from Firestore to MongoDB for ${currentUser.email || firebaseUid}:`,
                Object.keys(updateData)
            );
        }
    } catch (err) {
        const msg = String(err?.message || '');
        const missingCreds =
            msg.includes('Could not load the default credentials') ||
            msg.includes('applicationDefault') ||
            msg.includes('GOOGLE_APPLICATION_CREDENTIALS');

        if (missingCreds) {
            firestoreSyncDisabled = true;
            console.warn('[AUTH] Firestore role sync disabled for this process (missing Google credentials).');
        }
        console.warn('[AUTH] Firestore role sync skipped:', err.message);
    }

    return currentUser;
}

// Minimal helper for log readability without introducing more dependencies.
function uRoleDebug(role) {
    return role ?? 'unknown'
}
