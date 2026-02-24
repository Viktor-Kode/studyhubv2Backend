import { getEnv } from '../config/env.js';

export const errorHandler = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    console.error('💥 ERROR:', {
        status: err.status,
        message: err.message,
        stack: err.stack,
    });

    res.status(err.statusCode).json({
        status: err.status,
        message: err.message || 'Internal Server Error',
        ...(getEnv('NODE_ENV') === 'development' && { stack: err.stack })
    });
};


export const notFound = (req, res, next) => {
    const error = new Error(`Can't find ${req.originalUrl} on this server!`);
    error.statusCode = 404;
    error.status = 'fail';
    next(error);
};
