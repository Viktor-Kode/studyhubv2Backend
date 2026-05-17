import { z } from 'zod';

const QUESTION_TYPES = ['multiple-choice', 'theory', 'fill-in-the-blank', 'mixed'];

// POST /api/ai/generate-notes
export const generateNotesSchema = z.object({
  text: z.string().trim().min(50, 'Text must be at least 50 characters').max(100000).optional(),
  documentId: z.string().trim().optional(),
  modelId: z.string().trim().optional(),
  stream: z.boolean().optional().default(false),
}).refine((data) => data.text || data.documentId, {
  message: 'Either text or documentId must be provided',
  path: ['text'],
});

// POST /api/ai/generate-quiz
export const generateQuizSchema = z.object({
  text: z.string().trim().min(50, 'Text must be at least 50 characters').max(100000).optional(),
  documentId: z.string().trim().optional(),
  subject: z.string().trim().max(100).optional(),
  modelId: z.string().trim().optional(),
  amount: z
    .union([z.number(), z.string().transform(Number)])
    .refine((n) => n >= 1 && n <= 50, 'amount must be between 1 and 50')
    .optional()
    .default(5),
  questionType: z.enum(QUESTION_TYPES).optional().default('multiple-choice'),
  fileName: z.string().trim().max(255).optional(),
  forceNew: z.boolean().optional().default(false),
  stream: z.boolean().optional().default(false),
}).refine((data) => data.text || data.documentId, {
  message: 'Either text or documentId must be provided',
  path: ['text'],
});

// POST /api/ai/chat
export const chatWithTutorSchema = z.object({
  message: z
    .string({ required_error: 'message is required' })
    .trim()
    .min(1, 'Message cannot be empty')
    .max(10000, 'Message is too long'),
  context: z.string().trim().max(1000000).optional(),
  documentId: z.string().trim().optional(),
  chatHistory: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string().max(1000000),
      })
    )
    .max(100, 'Chat history too long')
    .optional()
    .default([]),
  modelId: z.string().trim().optional(),
  stream: z.boolean().optional().default(false),
});

// POST /api/ai/save-note
export const saveStudyNoteSchema = z.object({
  title: z
    .string({ required_error: 'title is required' })
    .trim()
    .min(1, 'Title cannot be empty')
    .max(200),
  content: z
    .string({ required_error: 'content is required' })
    .trim()
    .min(1, 'Content cannot be empty')
    .max(200000),
  sourceFileName: z.string().trim().max(255).optional(),
  tags: z.array(z.string().trim().max(50)).max(20).optional().default([]),
});

// POST /api/ai/fetch-url
export const fetchUrlSchema = z.object({
  url: z
    .string({ required_error: 'url is required' })
    .trim()
    .url('Must be a valid URL')
    .refine((u) => u.startsWith('http'), 'URL must start with http'),
});
