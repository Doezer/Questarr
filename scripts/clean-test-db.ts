import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '..', 'data', 'test.db');

if (fs.existsSync(dbPath)) {
    console.log('Cleaning test database:', dbPath);
    try {
        fs.unlinkSync(dbPath);
        console.log('Test database removed.');
    } catch (err) {
        console.error('Failed to remove test database:', err);
        process.exit(1);
    }
} else {
    console.log('No test database found to clean.');
}
