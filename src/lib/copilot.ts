import { CopilotClient } from '@github/copilot-sdk';
import { extractGitHubUrls, fetchLinkInfo, type GitHubLinkInfo } from './github';

const MODEL = 'gpt-4.1';

/**
 * Simple fallback: replace bare GitHub URLs with markdown links using fetched titles.
 */
function applyLinkification(
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
export async function callCopilot(
  systemPrompt: string, 
  userPrompt: string, 
  model: string = MODEL
): Promise<string> {
  const client = new CopilotClient();
  try {
    const session = await client.createSession({ model });
    // Send system context first, then user message
    await session.sendAndWait({ prompt: systemPrompt });
    const response = await session.sendAndWait({ prompt: userPrompt });
    return response?.data?.content ?? '';
  } finally {
    await client.stop();
  }
}

/**
 * Linkify a raw markdown work log by fetching GitHub link details and
 * replacing bare URLs with titled markdown links.
 */
export async function linkifyWorkLog(rawMarkdown: string): Promise<string> {
  const urls = await extractGitHubUrls(rawMarkdown);
  const linkMap = new Map<string, GitHubLinkInfo>();

  const results = await Promise.all(urls.map((u) => fetchLinkInfo(u)));
  for (const info of results) {
    if (info) linkMap.set(info.url, info);
  }

  return applyLinkification(rawMarkdown, linkMap);
}
