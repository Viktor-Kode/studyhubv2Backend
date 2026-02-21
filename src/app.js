import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import aiRoutes from './routes/aiRoutes.js';
import studyRoutes from './routes/studyRoutes.js';
import flashCardRoutes from './routes/flashCardRoutes.js';
import authRoutes from './routes/authRoutes.js';
import { errorHandler, notFound } from './middleware/errorMiddleware.js';

const app = express();

// Middlewares
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
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

app.get('/', (req, res) => {
  res.send('StudyHelp API is running...');
});

// Error handling
app.use(notFound);
app.use(errorHandler);

// THIS IS THE MISSING PIECE:
export default app;