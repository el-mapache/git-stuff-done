import { NextResponse } from 'next/server';
import { readLog, readRichLog } from '@/lib/files';
import { callCopilot, linkifyWorkLog } from '@/lib/copilot';

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { startDate, endDate, prompt, model } = await req.json();

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Missing start or end date' }, { status: 400 });
    }

    const logs: string[] = [];
    
    // Parse dates (assuming YYYY-MM-DD)
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    
    // Iterate day by day
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        
        // Try rich log first, fall back to raw log
        let content = await readRichLog(dateStr);
        if (!content) {
            content = await readLog(dateStr);
        }

        if (content && content.trim()) {
            logs.push(`## ${dateStr}\n\n${content.trim()}`);
        }
    }

    if (logs.length === 0) {
      return NextResponse.json({ summary: 'No work logs found for the selected date range.' });
    }

    // 2. Construct Prompt
    const fullLogContent = logs.join('\n\n---\n\n');
    const systemPrompt = `You are a helpful work log summarization assistant. 
You will be provided with a collection of work logs from a developer.
Your goal is to summarize them according to the user's specific instructions.
If no specific instructions are provided, assume a default summary focusing on what was completed and what is in progress.
Maintain a professional but concise tone. Use Markdown for formatting.
When referencing a GitHub issue or pull request, write the plain URL by itself with no markdown link formatting around it at all — no brackets, no parentheses, no link text of your own (e.g. just "https://github.com/org/repo/pull/123" on its own, not "[org/repo#123](https://github.com/org/repo/pull/123)"). A separate linkification pass will replace each bare URL with a proper titled link afterward, so writing your own link or label for it would be redundant and will be skipped.`;

    const userPrompt = `### User Instructions
${prompt || 'Summarize the key achievements and tasks worked on.'}

### Work Logs
${fullLogContent}`;

    // 3. Call Copilot (5 minute timeout)
    const summary = await callCopilot(systemPrompt, userPrompt, model, 300_000);

    // 4. Linkify: the model was asked to cite bare GitHub URLs (not compose
    // its own links), so replace them with titled markdown links here using
    // real issue/PR data — same convention used elsewhere in the app (see
    // linkifyWorkLog in src/lib/copilot.ts).
    const linkedSummary = await linkifyWorkLog(summary);

    return NextResponse.json({ summary: linkedSummary });

  } catch (error) {
    console.error('Summary generation error:', error);
    return NextResponse.json({ error: 'Failed to generate summary' }, { status: 500 });
  }
}
