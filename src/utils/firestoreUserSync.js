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

        const fsRole = snap.get('role');
        if (!fsRole || !VALID_ROLES.has(fsRole)) return currentUser;
        if (fsRole === currentUser.role) return currentUser;

        // Avoid accidental demotion: only promote to teacher from Firestore here.
        // MongoDB might still have an older/stale value (e.g. `student` or `unknown`),
        // so we promote whenever Firestore says `teacher` and Mongo isn't already teacher.
        if (fsRole === 'teacher' && currentUser.role !== 'teacher') {
            const prevRole = currentUser.role
            await User.findByIdAndUpdate(currentUser._id, { role: 'teacher' }, { runValidators: false });
            currentUser.role = 'teacher';
            console.log(
                `[AUTH] Synced teacher role from Firestore for ${currentUser.email || firebaseUid} (was: ${uRoleDebug(
                    prevRole
                )})`
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
