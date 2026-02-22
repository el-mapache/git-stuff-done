
import { writeSummary } from './src/lib/files';
import path from 'path';
import fs from 'fs';

// Mock process.cwd if needed, but likely not if running via ts-node from root
// However, ts-node might need configuration. 
// A simpler approach is to read the file and replicate the logic in a small script, 
// or use a test runner if available.

// Let's try running a small script that imports the function.
// Since it's a Next.js project, running a standalone script with imports might be tricky without ts-node setup.
// I'll first check the content of src/lib/files.ts to see if I can easily replicate it or if I should use a different approach.
