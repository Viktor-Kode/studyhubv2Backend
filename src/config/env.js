import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from the root .env file
dotenv.config({
    path: path.join(__dirname, '../../.env'),
    silent: true // Don't crash if .env is missing (Render injects them directly)
});

// REQUIRED VARIABLES
const required = [
    'MONGODB_URI',
    'JWT_SECRET',
    'DEEPSEEK_API_KEY',
    'ALOC_ACCESS_TOKEN',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
    'EMAIL_USERNAME',
    'EMAIL_PASSWORD',
    'EMAIL_FROM'
];


// MONGO_URI fallback check
if (!process.env.MONGODB_URI && process.env.MONGO_URI) {
    process.env.MONGODB_URI = process.env.MONGO_URI;
}

const missing = required.filter(key => {
    const val = process.env[key];
    return !val || val === 'undefined' || val === 'null';
});

if (missing.length > 0) {
    if (process.env.NODE_ENV === 'production') {
        console.error('❌ CRITICAL: Missing environment variables:', missing.join(', '));
        process.exit(1);
    } else {
        console.warn('⚠️  Warning: Missing environment variables:', missing.join(', '));
        console.warn('Backend may experience functional errors in non-production mode.');
    }
} else {
    if (process.env.NODE_ENV === 'development') {
        process.stdout.write('🌍 Environment variables validated (Development Mode)\n');
    }
}

export default process.env;
