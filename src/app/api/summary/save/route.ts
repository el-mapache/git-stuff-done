import { NextResponse } from 'next/server';
import { writeSummary } from '@/lib/files';
import { commitWorkLog } from '@/lib/git';

export async function POST(req: Request) {
  try {
    const { filename, content } = await req.json();

    if (!filename || !content) {
      return NextResponse.json({ error: 'Missing filename or content' }, { status: 400 });
    }

    // Basic validation to ensure filename is safe and ends in .md
    if (!filename.endsWith('.md') || filename.includes('/') || filename.includes('\\')) {
        return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }

    await writeSummary(filename, content);
    
    // Commit and push
    // We pass a specific message for the commit
    const commitRes = commitWorkLog(`docs(summary): add ${filename}`);

    return NextResponse.json({ success: true, path: filename, committed: commitRes.committed });
  } catch (error) {
    console.error('Failed to save summary:', error);
    return NextResponse.json({ error: 'Failed to save summary' }, { status: 500 });
  }
}
