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

if (process.env.NODE_ENV === 'development') {
    console.log('🌍 Environment variables loaded (Development)');
}

