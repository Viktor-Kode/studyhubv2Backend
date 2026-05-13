import { z } from 'zod';

const emailField = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .email('Please provide a valid email address');

const passwordField = z
  .string({ required_error: 'Password is required' })
  .min(6, 'Password must be at least 6 characters')
  .max(128, 'Password is too long');

// POST /api/users/signup
export const signupSchema = z.object({
  email: emailField,
  password: passwordField,
  name: z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name is too long'),
  role: z.enum(['student', 'teacher']).optional().default('student'),
  schoolName: z.string().trim().max(200).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{7,15}$/, 'Invalid phone number format')
    .optional()
    .or(z.literal('')),
});

// POST /api/users/login
export const loginSchema = z.object({
  email: emailField,
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
});

// POST /api/users/forgot-password
export const forgotPasswordSchema = z.object({
  email: emailField,
});

// PATCH /api/users/reset-password/:token
export const resetPasswordSchema = z.object({
  newPassword: passwordField,
  password: passwordField.optional(), // allow either field name
});

// PATCH /api/users/update-password
export const updatePasswordSchema = z.object({
  currentPassword: z.string({ required_error: 'Current password is required' }).min(1),
  newPassword: passwordField,
});

// PATCH /api/users/update-me
export const updateMeSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  role: z.enum(['student', 'teacher']).optional(),
  schoolName: z.string().trim().max(200).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{7,15}$/, 'Invalid phone number format')
    .optional()
    .or(z.literal('')),
});
