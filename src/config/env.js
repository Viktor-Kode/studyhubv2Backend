import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log(`[STARTUP] Raw NODE_ENV: ${process.env.NODE_ENV}, RENDER: ${process.env.RENDER}`);

/**
 * ENVIRONMENT LOADER
 * 
 * Rules:
 * 1. Only load .env files in local development.
 * 2. In Production (Render), variables are injected by the platform.
 * 3. Dotenv should NEVER override existing system variables.
 * 4. Normalizes 'undefined' and 'null' strings to real undefined.
 */

// 1. Determine if we are in production
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

// Force production mode if on Render
if (!!process.env.RENDER && process.env.NODE_ENV !== 'production') {
    process.env.NODE_ENV = 'production';
    console.log('[ENV] Detected Render environment. Forcing NODE_ENV to production.');
}

// 2. Load Dotenv (Development ONLY)
if (!isProduction) {
    // Try to load .env from the backend root
    const envPath = path.join(__dirname, '../../.env');
    dotenv.config({ path: envPath });
    console.log(`[ENV] Development mode: Loading variables from ${envPath}`);
} else {
    console.log(`[ENV] Production mode detected. Skipping dotenv. Using Render environment variables.`);

    // Explicitly check for leakage
    if (process.env.MONGODB_URI && process.env.MONGODB_URI.includes('localhost')) {
        console.warn('🚨 LEAKAGE DETECTED: MONGODB_URI is set to localhost in production!');
    }
}

/**
 * SAFE GETTER
 * Reads strictly from process.env at runtime.
 * Prevents the "undefined" (string) bug where process.env.KEY = "undefined"
 */
export const getEnv = (key, defaultValue = null) => {
    const value = process.env[key];

    // Check for empty, null, or the literal string "undefined"/"null"
    if (value === undefined || value === null || value === '' || value === 'undefined' || value === 'null') {
        return defaultValue;
    }

    return value;
};

// 3. REQUIRED VARIABLES VALIDATION (Startup check)
const required = [
    'MONGODB_URI',
    'JWT_SECRET'
];

// Fallback for MONGO_URI
if (!process.env.MONGODB_URI && process.env.MONGO_URI) {
    process.env.MONGODB_URI = process.env.MONGO_URI;
}

const missing = required.filter(key => {
    const val = getEnv(key);
    return !val;
});

if (missing.length > 0) {
    if (isProduction) {
        console.error('❌ CRITICAL: Missing required production environment variables:', missing.join(', '));
        // We exit in production if core variables are missing to prevent unstable state
        process.exit(1);
    } else {
        console.warn('⚠️  Warning: Missing local environment variables:', missing.join(', '));
        console.warn('Some features may not work until you create a .env file.');
    }
}

// 4. Feature Status (Safe logging)
const checkFeatures = () => {
    return {
        mongodb: !!getEnv('MONGODB_URI'),
        aloc: !!getEnv('ALOC_ACCESS_TOKEN'),
        twilio: (!!getEnv('TWILIO_ACCOUNT_SID') && !!getEnv('TWILIO_AUTH_TOKEN')),
        deepseek: !!getEnv('DEEPSEEK_API_KEY'),
        mode: process.env.NODE_ENV || 'development'
    };
};

console.log('[ENV] Feature Availability:', checkFeatures());

export default process.env;

