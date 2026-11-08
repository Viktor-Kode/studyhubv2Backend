import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import User from '../src/models/User.js';
import LibraryDocument from '../src/models/LibraryDocument.js';
import StudyPath from '../src/models/StudyPath.js';
import PaywallEvent from '../src/models/PaywallEvent.js';
import Transaction from '../src/models/Transaction.js';
import UserActivity from '../src/models/UserActivity.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '../.env') });

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

function toId(value) {
  return value == null ? '' : String(value);
}

function userIdFilter(ids) {
  const uniqueIds = [...new Set(ids.map(toId).filter((id) => id && id !== 'anonymous-user'))];
  const objectIds = uniqueIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const firebaseUids = uniqueIds;
  const clauses = [];
  if (objectIds.length) clauses.push({ _id: { $in: objectIds } });
  if (firebaseUids.length) clauses.push({ firebaseUid: { $in: firebaseUids } });
  return clauses.length ? { $or: clauses } : null;
}

async function auditConversionPipeline() {
  if (!mongoUri) {
    throw new Error('Set MONGODB_URI (or MONGO_URI) in the environment or backend .env file.');
  }

  await mongoose.connect(mongoUri);
  const now = new Date();

  const [totalRegisteredUsers, pdfDocumentUserIds, studyPathUserIds, successfulPaymentCount,
    pendingTransactionCount, failedTransactionCount, attemptedUserIds, successfulUserIds,
    incompleteAttemptUserIds, recentTransactions, activityDocs, paywallDocs, paywallUserIds, recentStudyPaths] = await Promise.all([
    User.countDocuments({ role: { $in: ['student', 'teacher'] } }),
    LibraryDocument.distinct('userId', {
      $or: [
        { fileType: /pdf|presentation|powerpoint/i },
        { originalName: /\.(pdf|pptx?)$/i },
      ],
    }),
    StudyPath.distinct('userId', { sourceFileName: /\.(pdf|pptx?)$/i }),
    Transaction.countDocuments({ status: 'success' }),
    Transaction.countDocuments({ status: 'pending' }),
    Transaction.countDocuments({ status: 'failed' }),
    Transaction.distinct('userId'),
    Transaction.distinct('userId', { status: 'success' }),
    Transaction.distinct('userId', { status: { $in: ['pending', 'failed'] } }),
    Transaction.find({}, { userId: 1, plan: 1, status: 1, createdAt: 1, processedAt: 1 })
      .sort({ createdAt: -1 }).limit(10).populate('userId', 'email').lean(),
    UserActivity.find({}).sort({ createdAt: -1 }).limit(10).populate('userId', 'email').lean(),
    PaywallEvent.find({}).sort({ timestamp: -1 }).limit(10).lean(),
    PaywallEvent.distinct('userId'),
    StudyPath.find({ sourceFileName: /\.(pdf|pptx?)$/i }, { userId: 1, title: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ]);

  const uploaderFilter = userIdFilter([...pdfDocumentUserIds, ...studyPathUserIds]);
  const studyPathOwnerFilter = userIdFilter(recentStudyPaths.map((studyPath) => studyPath.userId));
  const [uploadedRegisteredUsers, activeSubscriberUsers, studyPathOwners] = await Promise.all([
    uploaderFilter ? User.countDocuments({ role: { $in: ['student', 'teacher'] }, ...uploaderFilter }) : 0,
    User.countDocuments({
      role: { $ne: 'admin' },
      $or: [
        { subscriptionStatus: 'active', subscriptionEnd: { $gt: now } },
        { role: 'teacher', teacherPlan: { $nin: [null, 'free'] }, teacherPlanEnd: { $gt: now } },
      ],
    }),
    studyPathOwnerFilter ? User.find(studyPathOwnerFilter, { email: 1, firebaseUid: 1 }).lean() : [],
  ]);
  const userById = new Map();
  for (const user of studyPathOwners) {
    userById.set(toId(user._id), user);
    if (user.firebaseUid) userById.set(toId(user.firebaseUid), user);
  }
  const successfulUserIdSet = new Set(successfulUserIds.map(toId));
  const paymentDropOffUsers = new Set(incompleteAttemptUserIds.map(toId).filter((id) => id && !successfulUserIdSet.has(id))).size;
  const featurePaywallUsersWithoutSuccessfulPayment = new Set(
    paywallUserIds.map(toId).filter((id) => id && !successfulUserIdSet.has(id)),
  ).size;

  const events = [
    ...activityDocs.map((activity) => ({
      timestamp: activity.createdAt,
      email: activity.userId?.email || null,
      action: [activity.title, activity.subtitle].filter(Boolean).join(' — '),
      source: 'user_activity',
    })),
    ...paywallDocs.map((event) => ({
      timestamp: event.timestamp,
      email: event.userEmail || userById.get(toId(event.userId))?.email || null,
      action: `Paywall hit: ${event.action}`,
      source: 'paywall_event',
    })),
    ...recentTransactions.map((transaction) => ({
      timestamp: transaction.processedAt || transaction.createdAt,
      email: transaction.userId?.email || null,
      action: transaction.status === 'success'
        ? `Payment success — ${transaction.plan} plan`
        : transaction.status === 'failed'
          ? `Payment failed — ${transaction.plan} plan`
          : `Payment started — ${transaction.plan} plan (${transaction.status})`,
      source: 'transaction',
      ...(transaction.status === 'failed' && !transaction.processedAt
        ? { timestampNote: 'Checkout start time; the current transaction model does not store the failure time.' }
        : {}),
    })),
    ...recentStudyPaths.map((studyPath) => ({
      timestamp: studyPath.createdAt,
      email: userById.get(toId(studyPath.userId))?.email || null,
      action: `Roadmap generated — ${studyPath.title}`,
      source: 'study_path',
    })),
  ]
    .filter((event) => event.timestamp)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10)
    .map((event) => ({ ...event, timestamp: new Date(event.timestamp).toISOString() }));

  return {
    generatedAt: now.toISOString(),
    metrics: {
      totalRegisteredUsers,
      registeredUsersDefinition: 'Student and teacher accounts; admin accounts are excluded.',
      usersWithPdfOrSlideDeckUpload: uploadedRegisteredUsers,
      uploadRatePercent: totalRegisteredUsers ? Number(((uploadedRegisteredUsers / totalRegisteredUsers) * 100).toFixed(2)) : 0,
      checkoutAttemptUsers: attemptedUserIds.length,
      paymentDropOffUsers,
      paymentDropOffDefinition: 'Unique users with a pending or failed checkout transaction and no successful transaction. Checkout transactions are created when payment initialization begins.',
      featurePaywallUsersWithoutSuccessfulPayment,
      featurePaywallDefinition: 'Unique users with a recorded feature-limit PaywallEvent and no successful transaction.',
      successfulPayments: successfulPaymentCount,
      activeSubscriptions: {
        total: activeSubscriberUsers,
        student: await User.countDocuments({
          role: 'student',
          subscriptionStatus: 'active',
          subscriptionEnd: { $gt: now },
        }),
        teacher: await User.countDocuments({
          role: 'teacher',
          teacherPlan: { $nin: [null, 'free'] },
          teacherPlanEnd: { $gt: now },
        }),
      },
      transactionStatusCounts: {
        pending: pendingTransactionCount,
        failed: failedTransactionCount,
        success: successfulPaymentCount,
      },
    },
    recentActivity: events,
  };
}

try {
  const report = await auditConversionPipeline();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error('[conversion-audit] Failed:', error.message);
  process.exitCode = 1;
} finally {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
