import { ZodError } from 'zod';

/**
 * Express middleware factory that validates req.body against a Zod schema.
 * On failure it returns a 400 with a structured error list.
 * On success it replaces req.body with the parsed (coerced + stripped) data.
 *
 * Usage:
 *   router.post('/signup', validate(signupSchema), signupController);
 */
export const validate = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (err) {
    if (err instanceof ZodError) {
      const errors = err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      console.error(`[Validation Failed] on ${req.originalUrl || req.url}:`, JSON.stringify(errors, null, 2));
      return res.status(400).json({
        status: 'fail',
        message: 'Validation failed',
        errors,
      });
    }
    next(err);
  }
};

/**
 * Same as validate() but for req.query (GET params).
 * Stores the parsed result in req.validatedQuery because Express's
 * req.query is a getter-only property that cannot be reassigned.
 */
export const validateQuery = (schema) => (req, res, next) => {
  try {
    req.validatedQuery = schema.parse(req.query);
    next();
  } catch (err) {
    if (err instanceof ZodError) {
      const errors = err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid query parameters',
        errors,
      });
    }
    next(err);
  }
};
