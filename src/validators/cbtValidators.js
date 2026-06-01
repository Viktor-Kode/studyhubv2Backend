import { z } from 'zod';

const VALID_EXAM_TYPES = ['utme', 'jamb', 'waec', 'wassce', 'neco', 'bece', 'post-utme', 'PDF_CBT', 'AI_STUDY'];

// GET /api/cbt/questions  (query params)
export const getQuestionsQuerySchema = z.object({
  subject: z
    .string({ required_error: 'subject is required' })
    .trim()
    .min(1, 'subject cannot be empty')
    .max(80),
  type: z.string().trim().toLowerCase().optional(),
  year: z
    .string()
    .regex(/^\d{4}$|^any$/, 'year must be a 4-digit year or "any"')
    .optional(),
  amount: z
    .string()
    .regex(/^\d+$/, 'amount must be a number')
    .transform(Number)
    .refine((n) => n >= 1 && n <= 100, 'amount must be between 1 and 100')
    .optional(),
});

// POST /api/cbt/save-result
export const saveCBTResultSchema = z.object({
  subject: z.string({ required_error: 'subject is required' }).trim().min(1).max(80),
  examType: z.string().trim().optional(),
  year: z.union([z.string(), z.number()]).optional(),
  totalQuestions: z.number().int().min(1).max(200).optional(),
  timeTaken: z.number().min(0).max(86400).optional(), // seconds, max 24h
  studyGroupId: z.string().optional(),
  answers: z
    .array(
      z.object({
        questionId: z.union([z.string(), z.number()]),
        selectedAnswer: z.string().optional(),
        isCorrect: z.boolean().optional(),
        correctAnswer: z.string().optional(),
        question: z.string().optional(),
        explanation: z.string().optional(),
      })
    )
    .max(200)
    .optional(),
});

// POST /api/cbt/explain
export const explainQuestionSchema = z.object({
  question: z.string({ required_error: 'question is required' }).trim().min(5).max(2000),
  correctAnswer: z.string({ required_error: 'correctAnswer is required' }).trim().min(1).max(500),
  options: z.array(z.string().max(500)).max(6).optional().default([]),
  stream: z.boolean().optional().default(false),
  subject: z.string().max(80).optional(),
});

// POST /api/cbt/generate-topic-questions
export const generateTopicQuestionsSchema = z.object({
  exam: z
    .string({ required_error: 'exam is required' })
    .trim()
    .toUpperCase()
    .refine((v) => ['JAMB', 'WAEC', 'NECO', 'UTME'].includes(v), {
      message: 'exam must be one of: JAMB, WAEC, NECO, UTME',
    }),
  subject: z.string({ required_error: 'subject is required' }).trim().min(1).max(80),
  topic: z.string({ required_error: 'topic is required' }).trim().min(2).max(200),
  count: z
    .union([z.number(), z.string().transform(Number)])
    .refine((n) => n >= 1 && n <= 20, 'count must be between 1 and 20')
    .optional()
    .default(5),
});

// POST /api/cbt/verify-answer
export const verifyAnswerSchema = z.object({
  questionId: z.union([z.string(), z.number()]),
  selectedAnswer: z.string({ required_error: 'selectedAnswer is required' }).max(500),
  questionText: z.string().optional(),
  isAiGenerated: z.boolean().optional().default(false),
  subject: z.string().optional(),
  year: z.union([z.string(), z.number()]).optional(),
  examType: z.string().optional(),
});
