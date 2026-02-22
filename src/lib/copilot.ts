import { CopilotClient } from '@github/copilot-sdk';
import { extractGitHubUrls, fetchLinkInfo, type GitHubLinkInfo } from './github';

const MODEL = 'gpt-4.1';

/**
 * Simple fallback: replace bare GitHub URLs with markdown links using fetched titles.
 */
function applyFallbackEnrichment(
  markdown: string,
  linkMap: Map<string, GitHubLinkInfo>,
): string {
  let result = markdown;
  linkMap.forEach((info, url) => {
    const label = `${info.title} (#${info.number})`;
    // Only replace bare URLs (not already inside markdown links)
    const bare = new RegExp(`(?<!\\()${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\))`, 'g');
    result = result.replace(bare, `[${label}](${url})`);
  });
  return result;
}

/**
 * Call the Copilot SDK with a system prompt and user prompt, return the response.
 */
async function callCopilot(systemPrompt: string, userPrompt: string): Promise<string> {
  const client = new CopilotClient();
  try {
    const session = await client.createSession({ model: MODEL });
    // Send system context first, then user message
    await session.sendAndWait({ prompt: systemPrompt });
    const response = await session.sendAndWait({ prompt: userPrompt });
    return response?.data?.content ?? '';
  } finally {
    await client.stop();
  }
}

/**
 * Enrich a raw markdown work log by fetching GitHub link details and
 * using the Copilot SDK to rewrite it with richer context.
 */
export async function enrichWorkLog(rawMarkdown: string): Promise<string> {
  // 1. Extract GitHub URLs and fetch details
  const urls = await extractGitHubUrls(rawMarkdown);
  const linkMap = new Map<string, GitHubLinkInfo>();

  const results = await Promise.all(urls.map((u) => fetchLinkInfo(u)));
  for (const info of results) {
    if (info) linkMap.set(info.url, info);
  }

  // Build context mapping URLs → details
  const context: Record<string, { title: string; number: number; type: string; state: string; labels: string[] }> = {};
  linkMap.forEach((info, url) => {
    context[url] = {
      title: info.title,
      number: info.number,
      type: info.type,
      state: info.state,
      labels: info.labels,
    };
  });

  // 2. Call Copilot SDK to enrich
  try {
    const systemPrompt = `You are a technical writing assistant. You will receive a raw markdown work log and a JSON object mapping GitHub URLs to their details (title, type, state, labels).

Your job:
- Replace bare GitHub URLs with formatted markdown links that include the title, e.g. [Fix auth bug (#123)](https://github.com/org/repo/pull/123)
- Keep the original meaning intact
- Do not add information that cannot be inferred from the log or issue/PR title
- Return only the enhanced markdown, no extra commentary or headings`;

    const userPrompt = `## GitHub Link Context
\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\`

## Raw Work Log
${rawMarkdown}`;

    const enhanced = await callCopilot(systemPrompt, userPrompt);
    return enhanced || applyFallbackEnrichment(rawMarkdown, linkMap);
  } catch {
    // Fallback: just do URL replacement without AI
    return applyFallbackEnrichment(rawMarkdown, linkMap);
  }
}

export { callCopilot };
