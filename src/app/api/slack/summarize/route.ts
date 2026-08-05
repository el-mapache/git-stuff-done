import { NextResponse } from 'next/server';
import { callCopilot } from '@/lib/copilot';

const DEFAULT_SYSTEM_PROMPT = `You are a Slack thread summarizer. Write short, direct summaries — \
2–4 bullet points or 1–2 short paragraphs, whichever fits better. \
No headings, no sections, no preamble like "Here is a summary". \
Only include what matters: key conclusions, decisions, and clear next steps.`;

export async function POST(req: Request) {
  try {
    const { markdown, model, feedback, previousSummary, customInstructions, overridePrompt } = await req.json();

    if (!markdown || typeof markdown !== 'string') {
      return NextResponse.json({ error: 'Missing markdown content' }, { status: 400 });
    }
    if (!model || typeof model !== 'string') {
      return NextResponse.json({ error: 'Missing model' }, { status: 400 });
    }

    let systemPrompt: string;
    if (customInstructions && overridePrompt) {
      systemPrompt = customInstructions;
    } else if (customInstructions) {
      systemPrompt = `${DEFAULT_SYSTEM_PROMPT}\n\nAdditional instructions: ${customInstructions}`;
    } else {
      systemPrompt = DEFAULT_SYSTEM_PROMPT;
    }

    let userPrompt: string;

    if (feedback && previousSummary) {
      userPrompt = `The user rejected your previous summary. Their feedback is: "${feedback}"

Rewrite the summary of this Slack thread addressing that feedback directly. Do not repeat the same approach as before.

Slack thread:
${markdown}

Previous summary (for reference only — write a better one):
${previousSummary}`;
    } else {
      userPrompt = `Summarize this Slack thread:

${markdown}`;
    }

    const summary = await callCopilot(systemPrompt, userPrompt, model);

    return NextResponse.json({ summary });
  } catch (error) {
    console.error('[slack/summarize] Failed to generate summary:', error);
    return NextResponse.json({ error: 'Failed to generate summary' }, { status: 500 });
  }
}
