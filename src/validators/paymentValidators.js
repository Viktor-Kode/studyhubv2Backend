import { z } from 'zod';
import { PLANS, TEACHER_PLANS } from '../config/plans.js';

const VALID_PLANS = Array.from(new Set([...Object.keys(PLANS || {}), ...Object.keys(TEACHER_PLANS || {})]));

// POST /api/payment/initialize
export const initializePaymentSchema = z.object({
  plan: z
    .string({ required_error: 'plan is required' })
    .trim()
    .refine((v) => VALID_PLANS.includes(v), {
      message: `plan must be one of: ${VALID_PLANS.join(', ')}`,
    }),
});

// POST /api/payment/verify
export const verifyPaymentSchema = z.object({
  transaction_id: z
    .union([z.string(), z.number()])
    .transform(String)
    .refine((v) => v.length > 0, 'transaction_id is required'),
  tx_ref: z
    .string({ required_error: 'tx_ref is required' })
    .trim()
    .min(1, 'tx_ref cannot be empty')
    .regex(/^SH-/, 'Invalid transaction reference format'),
});
