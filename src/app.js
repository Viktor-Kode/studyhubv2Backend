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
import notificationRoutes from './routes/notificationRoutes.js';
import { errorHandler, notFound } from './middleware/errorMiddleware.js';
import { getEnv } from './config/env.js';


const app = express();

// TRUST PROXY - Required for Render/Vercel to get real IP for rate limiting
app.set('trust proxy', 1);

// Middlewares
app.use(helmet());

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

app.use(express.json());

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


// SILENCE FAVICON ERRORS
app.get('/favicon.ico', (req, res) => res.status(204).end());

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

app.get('/', (req, res) => {
  res.send('StudyHelp API is running...');
});

// Error handling
app.use(notFound);
app.use(errorHandler);

export default app;
