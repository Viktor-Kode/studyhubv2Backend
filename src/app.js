import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import aiRoutes from './routes/aiRoutes.js';
import studyRoutes from './routes/studyRoutes.js';
import flashCardRoutes from './routes/flashCardRoutes.js';
import authRoutes from './routes/authRoutes.js';
import reminderRoutes from './routes/reminderRoutes.js';
import classRoutes from './routes/classRoutes.js';
import questionRoutes from './routes/questionRoutes.js';
import examRoutes from './routes/examRoutes.js';
import markingRoutes from './routes/markingRoutes.js';
import resourceRoutes from './routes/resourceRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import studentRoutes from './routes/studentRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import debugRoutes from './routes/debugRoutes.js';
import { errorHandler, notFound } from './middleware/errorMiddleware.js';

const app = express();

// Middlewares
app.use(helmet());
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://studyhubv2-self.vercel.app',
  'https://studyhelp-zyqw.onrender.com',
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    // Allow any vercel.app subdomain (preview deployments) or listed origins
    if (
      allowedOrigins.includes(origin) ||
      /^https:\/\/[a-z0-9-]+(\.vercel\.app)$/.test(origin)
    ) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS: ' + origin));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true
}));
app.use(express.json());

// Routes
app.use('/api/ai', aiRoutes);
app.use('/api/study', studyRoutes);
app.use('/api/flashcards', flashCardRoutes);
app.use('/api/users', authRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/marking', markingRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/debug', debugRoutes);

app.get('/', (req, res) => {
  res.send('StudyHelp API is running...');
});

// Error handling
app.use(notFound);
app.use(errorHandler);

// THIS IS THE MISSING PIECE:
export default app;
