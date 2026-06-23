/**
 * One-time migration: enforce free-tier limits on existing users.
 *
 * Targets:
 *   - subscriptionStatus === 'free'   → aiUsageLimit, noteUsageLimit, quizUsageLimit all capped at 3
 *   - subscriptionStatus === 'expired' → same
 *   - Missing noteUsageLimit / quizUsageLimit fields → set to 3 for free, 999999 for active
 *
 * Active (paid) users are untouched EXCEPT to backfill missing note/quiz limit fields.
 *
 * Usage:
 *   node scripts/migrate-free-tier-limits.js            # dry-run (no writes)
 *   node scripts/migrate-free-tier-limits.js --apply    # actually writes to DB
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// Load env from backend root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌  MONGODB_URI not found in .env');
  process.exit(1);
}

const DRY_RUN = !process.argv.includes('--apply');

// ─── Inline minimal schema (avoids import chain issues) ─────────────────────
const userSchema = new mongoose.Schema({}, { strict: false });
const User = mongoose.model('User', userSchema);

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅  Connected to MongoDB');
  console.log(DRY_RUN ? '🔍  DRY-RUN mode — no changes will be saved.\n' : '⚡  APPLY mode — changes WILL be saved.\n');

  // ─── 1. Free / Expired users ──────────────────────────────────────────────
  const freeTierFilter = {
    $or: [
      { subscriptionStatus: 'free' },
      { subscriptionStatus: 'expired' },
      { subscriptionStatus: { $exists: false } },
      { subscriptionStatus: null },
    ],
    role: { $ne: 'admin' },
  };

  const freeUsers = await User.find(freeTierFilter)
    .select('_id email subscriptionStatus aiUsageLimit noteUsageLimit quizUsageLimit')
    .lean();

  console.log(`Found ${freeUsers.length} free/expired user(s) to update.\n`);

  let freeCapped = 0;
  let freeAlreadyOk = 0;

  for (const u of freeUsers) {
    const needsUpdate =
      (u.aiUsageLimit ?? 999999) > 3 ||
      u.noteUsageLimit === undefined ||
      u.noteUsageLimit === null ||
      u.quizUsageLimit === undefined ||
      u.quizUsageLimit === null;

    if (!needsUpdate) {
      freeAlreadyOk++;
      continue;
    }

    console.log(
      `  [FREE] ${u.email} — aiLimit: ${u.aiUsageLimit} → 3 | noteLimit: ${u.noteUsageLimit ?? 'unset'} → 3 | quizLimit: ${u.quizUsageLimit ?? 'unset'} → 3`
    );

    if (!DRY_RUN) {
      await User.updateOne(
        { _id: u._id },
        {
          $set: {
            aiUsageLimit: 3,
            noteUsageLimit: 3,
            quizUsageLimit: 3,
          },
        }
      );
    }
    freeCapped++;
  }

  // ─── 2. Active (paid) users — backfill missing note/quiz limit fields ─────
  const activeFilter = {
    subscriptionStatus: 'active',
    $or: [
      { noteUsageLimit: { $exists: false } },
      { noteUsageLimit: null },
      { quizUsageLimit: { $exists: false } },
      { quizUsageLimit: null },
    ],
    role: { $ne: 'admin' },
  };

  const activeUsers = await User.find(activeFilter)
    .select('_id email subscriptionStatus noteUsageLimit quizUsageLimit')
    .lean();

  console.log(`\nFound ${activeUsers.length} active user(s) missing note/quiz limit fields.\n`);

  let activePatchCount = 0;
  for (const u of activeUsers) {
    console.log(`  [ACTIVE] ${u.email} — noteLimit: ${u.noteUsageLimit ?? 'unset'} → 999999 | quizLimit: ${u.quizUsageLimit ?? 'unset'} → 999999`);

    if (!DRY_RUN) {
      await User.updateOne(
        { _id: u._id },
        {
          $set: {
            noteUsageLimit: 999999,
            quizUsageLimit: 999999,
          },
        }
      );
    }
    activePatchCount++;
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────');
  console.log(`Free/expired users already correct : ${freeAlreadyOk}`);
  console.log(`Free/expired users updated         : ${freeCapped}`);
  console.log(`Active users backfilled            : ${activePatchCount}`);
  console.log('─────────────────────────────────────');

  if (DRY_RUN) {
    console.log('\n⚠️  DRY-RUN — nothing was written. Re-run with --apply to commit changes.');
  } else {
    console.log('\n✅  Migration complete.');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌  Migration failed:', err.message);
  process.exit(1);
});
