import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import aiRoutes from './routes/aiRoutes.js';
import studyRoutes from './routes/studyRoutes.js';
import flashCardRoutes from './routes/flashCardRoutes.js';
import authRoutes from './routes/authRoutes.js';
import reminderRoutes from './routes/reminderRoutes.js';
import classRoutes from './routes/classRoutes.js';
import questionRoutes from './routes/questionRoutes.js';
import cbtRoutes from './routes/cbtRoutes.js';
import examRoutes from './routes/examRoutes.js';
import markingRoutes from './routes/markingRoutes.js';
import resourceRoutes from './routes/resourceRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import studentRoutes from './routes/studentRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import debugRoutes from './routes/debugRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import noteRoutes from './routes/noteRoutes.js';
import libraryRoutes from './routes/libraryRoutes.js';
import sharedNoteRoutes from './routes/sharedNoteRoutes.js';
import sharedLibraryRoutes from './routes/sharedLibraryRoutes.js';
import groupCBTRoutes from './routes/groupCBTRoutes.js';
import pomodoroRoutes from './routes/pomodoroRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import postutmeRoutes from './routes/postutmeRoutes.js';
import adminPostutmeRoutes from './routes/adminPostutmeRoutes.js';
import teacherRoutes from './routes/teacherRoutes.js';
import teacherToolsRoutes from './routes/teacherToolsRoutes.js';
import progressRoutes from './routes/progressRoutes.js';
import communityRoutes from './routes/communityRoutes.js';
import groupsRoutes from './routes/groupsRoutes.js';
import studyGroupRoutes from './routes/studyGroupRoutes.js';
import pdfCbtRoutes from './routes/pdfCbtRoutes.js';
import SharedNote from './models/SharedNote.js';
import SharedLibraryItem from './models/SharedLibraryItem.js';
import Group from './models/Group.js';
import { errorHandler, notFound } from './middleware/errorMiddleware.js';
import { getEnv } from './config/env.js';
import { unsubscribe } from './controllers/emailCampaignController.js';


const app = express();

// TRUST PROXY - Required for Render/Vercel to get real IP for rate limiting
app.set('trust proxy', 1);

// Middlewares
app.use(helmet());

// URL normalization and protocol enforcement for canonical URLs.
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.get('x-forwarded-proto') === 'http') {
    return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
  }

  if (req.path.length > 1 && req.path.endsWith('/')) {
    const normalized = req.path.replace(/\/+$/, '');
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(301, `${normalized}${query}`);
  }

  return next();
});

// GLOBAL RATE LIMITER
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 429, message: 'Too many requests from this IP, please try again later.' }
});

// Apply rate limiter to all routes
app.use(limiter);

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://studyhubv2-self.vercel.app',
  'https://studyhelp-zyqw.onrender.com',
  'https://mozilla.github.io',
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes(origin) ||
      /^https:\/\/[a-z0-9-]+(\.vercel\.app)$/.test(origin) ||
      /^https:\/\/[a-z0-9-]+(\.onrender\.com)$/.test(origin)
    ) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS: ' + origin));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true
}));

// Paystack webhook must receive raw body for HMAC verification
app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// HEALTH CHECK (For Render/uptime monitoring)

app.get('/api/health', (req, res) => {
  const healthStatus = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      aloc: !!getEnv('ALOC_ACCESS_TOKEN') ? 'configured' : 'missing',
      ycloud: (!!getEnv('YCLOUD_API_KEY') && !!getEnv('YCLOUD_WHATSAPP_NUMBER')) ? 'configured' : 'missing',
      deepseek: !!getEnv('DEEPSEEK_API_KEY') ? 'configured' : 'missing'
    }
  };

  const isAllOk = Object.values(healthStatus.services).every(v => v === 'connected' || v === 'configured');
  res.status(isAllOk ? 200 : 207).json(healthStatus);
});

app.get('/robots.txt', (req, res) => {
  const siteUrl = getEnv('SITE_URL', 'https://studyhub.com');
  res.type('text/plain');
  res.send(
    `User-agent: *
Allow: /
Disallow: /dashboard/
Disallow: /api/
Sitemap: ${siteUrl}/sitemap.xml
`
  );
});

app.get('/sitemap.xml', async (req, res) => {
  const siteUrl = getEnv('SITE_URL', 'https://studyhub.com').replace(/\/+$/, '');
  const now = new Date().toISOString();

  const staticRoutes = [
    { loc: '/', changefreq: 'daily', priority: '1.0', lastmod: now },
  ];

  const [notes, libraryItems, publicGroups] = await Promise.all([
    SharedNote.find({ isPublic: true }).select('_id updatedAt').lean(),
    SharedLibraryItem.find({ moderationStatus: 'approved' }).select('_id updatedAt').lean(),
    Group.find({ isPrivate: false }).select('_id updatedAt').lean(),
  ]);

  const dynamicRoutes = [
    ...notes.map((note) => ({
      loc: `/notes/${note._id}`,
      changefreq: 'weekly',
      priority: '0.7',
      lastmod: note.updatedAt ? new Date(note.updatedAt).toISOString() : now,
    })),
    ...libraryItems.map((item) => ({
      loc: `/library/${item._id}`,
      changefreq: 'weekly',
      priority: '0.6',
      lastmod: item.updatedAt ? new Date(item.updatedAt).toISOString() : now,
    })),
    ...publicGroups.map((group) => ({
      loc: `/groups/${group._id}`,
      changefreq: 'weekly',
      priority: '0.6',
      lastmod: group.updatedAt ? new Date(group.updatedAt).toISOString() : now,
    })),
  ];

  const allRoutes = [...staticRoutes, ...dynamicRoutes];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allRoutes
  .map(
    (url) => `  <url>
    <loc>${siteUrl}${url.loc}</loc>
    <lastmod>${url.lastmod}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;

  res.header('Content-Type', 'application/xml');
  res.send(xml);
});


// SILENCE FAVICON ERRORS
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Public unsubscribe (no auth — link in emails)
app.get('/api/unsubscribe', unsubscribe);

// Specific rate limiter for CBT and AI endpoints
const cbtAILimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // Limit each user to 10 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 429, message: 'Too many requests, please slow down.' }
});

// Routes
app.use('/api/ai', cbtAILimiter, aiRoutes);
app.use('/api/study', studyRoutes);
app.use('/api/flashcards', flashCardRoutes);
app.use('/api/users', authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/cbt', cbtAILimiter, cbtRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/marking', markingRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/debug', debugRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/shared-notes', sharedNoteRoutes);
app.use('/api/shared-library', sharedLibraryRoutes);
app.use('/api/group-cbt', groupCBTRoutes);
app.use('/api/pomodoro', pomodoroRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/postutme', postutmeRoutes);
app.use('/api/admin/postutme', adminPostutmeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/teacher-tools', teacherToolsRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/groups', groupsRoutes);
// Study groups (community tab) — separate from legacy /api/groups collaboration feature
app.use('/api/study-groups', studyGroupRoutes);
app.use('/api/pdf-cbt', cbtAILimiter, pdfCbtRoutes);

app.get('/', (req, res) => {
  res.send('StudyHelp API is running...');
});

// Error handling
app.use(notFound);
app.use(errorHandler);

export default app;
