
import { writeSummary } from './src/lib/files';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('Current working directory:', process.cwd());
  console.log('LOGPILOT_DATA_DIR:', process.env.LOGPILOT_DATA_DIR);

  const testFilename = 'test-summary.md';
  const testContent = '# Test Summary\n\nThis is a test summary.';

  try {
    console.log(`Attempting to write summary to ${testFilename}...`);
    await writeSummary(testFilename, testContent);
    console.log('writeSummary completed successfully.');

    // Check if file exists
    // We need to know where it wrote to. Based on logic, it should be in process.cwd()/summaries/test-summary.md
    // unless LOGPILOT_DATA_DIR is set.
    
    // We can't import getSummaryPath easily without exporting it or duplicating logic, 
    // but writeSummary calls ensureDirs which uses summariesDir.
    
    const expectedDir = path.join(process.cwd(), 'summaries');
    const expectedFile = path.join(expectedDir, testFilename);

    if (fs.existsSync(expectedFile)) {
        console.log(`SUCCESS: File created at ${expectedFile}`);
        // Clean up
        fs.unlinkSync(expectedFile);
        // fs.rmdirSync(expectedDir); // Don't remove dir if it might contain other things, though for test it is fine.
    } else {
        console.error(`FAILURE: File NOT found at ${expectedFile}`);
        // List contents of cwd to see if it went somewhere else
        console.log('Contents of cwd:', fs.readdirSync(process.cwd()));
    }

  } catch (error) {
    console.error('Error executing writeSummary:', error);
  }
}

main();
