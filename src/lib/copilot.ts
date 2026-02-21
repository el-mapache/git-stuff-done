import { getGitHubToken } from './github';
import { extractGitHubUrls, fetchLinkInfo, type GitHubLinkInfo } from './github';

const MODELS_API = 'https://models.inference.ai.azure.com/chat/completions';
const MODEL = 'gpt-4o';

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
 * Call GitHub Models API (gpt-4o) with the given messages.
 */
async function callModel(
  token: string,
  messages: { role: string; content: string }[],
): Promise<string> {
  const res = await fetch(MODELS_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, messages }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Models API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * Enrich a raw markdown work log by fetching GitHub link details and
 * using an AI model to rewrite it with richer context.
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

  // 2. Call AI model to enrich
  try {
    const token = await getGitHubToken();

    const systemPrompt = `You are a technical writing assistant. You will receive a raw markdown work log and a JSON object mapping GitHub URLs to their details (title, type, state, labels).

Your job:
- Replace bare GitHub URLs with formatted markdown links that include the title, e.g. [Fix auth bug (#123)](https://github.com/org/repo/pull/123)
- Expand terse bullet points into more descriptive ones using context from the linked issues/PRs
- Keep the original structure, heading hierarchy, and meaning intact
- Do not add information that cannot be inferred from the log or the provided context
- Return only the enhanced markdown, no extra commentary`;

    const userPrompt = `## GitHub Link Context
\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\`

## Raw Work Log
${rawMarkdown}`;

    const enhanced = await callModel(token, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    return enhanced || applyFallbackEnrichment(rawMarkdown, linkMap);
  } catch {
    // Fallback: just do URL replacement without AI
    return applyFallbackEnrichment(rawMarkdown, linkMap);
  }
}
