import { NextResponse } from 'next/server';
import { callCopilot } from '@/lib/copilot';
import { extractGitHubUrls } from '@/lib/github';
import {
  loadLogsForRange,
  fetchGitHubContext,
  classifySearchQuery,
} from '@/lib/search';
import type { GitHubContextItem, SearchMode } from '@/lib/search';

const MAX_LOOKBACK_DAYS = 365;
const WINDOW_SIZE = 7;
const MAX_ITERATIONS_PER_REQUEST = 7; // ~49 days per request to avoid timeouts
const EXHAUSTIVE_CHUNK_DAYS = 60;
const MAX_SINGLE_SHOT_CHARS = 200_000;

const NEED_MORE_CONTEXT = 'NEED_MORE_CONTEXT';

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function buildSystemPrompt(todayDate: string, mode: SearchMode): string {
  const base = `You are a helpful assistant that answers questions about a developer's work logs.
Today's date is ${todayDate}. Use this to interpret relative time expressions like "last week", "a month ago", "yesterday", etc.`;

  if (mode === 'exhaustive') {
    return `${base}

IMPORTANT RULES:
- Answer ONLY based on the work logs and GitHub context provided below.
- Find and list ALL instances, occurrences, and examples relevant to the question.
- Be COMPREHENSIVE — do not stop at the first match. List every relevant entry with its date.
- If you find multiple instances, organize them chronologically.
- If the logs do not contain any relevant information, respond with exactly: ${NEED_MORE_CONTEXT}
- NEVER fabricate, guess, or make up information.
- Use Markdown formatting in your response.`;
  }

  return `${base}

IMPORTANT RULES:
- Answer ONLY based on the work logs and GitHub context provided below.
- If the logs do not contain enough information to answer the question, respond with exactly: ${NEED_MORE_CONTEXT}
- NEVER fabricate, guess, or make up information. If you are not sure, say ${NEED_MORE_CONTEXT}.
- Be concise and specific. Reference dates and PR/issue numbers when relevant.
- Use Markdown formatting in your response.`;
}

function buildUserPrompt(
  query: string,
  logs: string[],
  githubContext: GitHubContextItem[],
  searchWindow: string,
): string {
  let prompt = `### Question\n${query}\n\n### Search Window\n${searchWindow}\n\n### Work Logs\n`;
  prompt += logs.join('\n\n---\n\n');

  if (githubContext.length > 0) {
    prompt += '\n\n### Referenced GitHub Items\n';
    for (const item of githubContext) {
      prompt += `\n#### ${item.type === 'pull' ? 'PR' : 'Issue'}: ${item.title} (${item.state})\nURL: ${item.url}\n`;
      if (item.body) {
        prompt += `Body:\n${item.body}\n`;
      }
      if (item.recentComments.length > 0) {
        prompt += `Recent comments:\n${item.recentComments.join('\n')}\n`;
      }
    }
  }

  return prompt;
}

async function collectUrlsFromLogs(logs: string[]): Promise<Set<string>> {
  const urls = new Set<string>();
  for (const log of logs) {
    const found = await extractGitHubUrls(log);
    found.forEach((u) => urls.add(u));
  }
  return urls;
}

/**
 * Load all available logs up to MAX_LOOKBACK_DAYS from today.
 */
async function loadAllLogs(
  today: Date,
): Promise<{ logs: string[]; daysSearched: number }> {
  const endDate = formatDate(today);
  const start = new Date(today);
  start.setDate(start.getDate() - MAX_LOOKBACK_DAYS);
  const startDate = formatDate(start);
  const logs = await loadLogsForRange(startDate, endDate);
  return { logs, daysSearched: MAX_LOOKBACK_DAYS };
}

/**
 * Exhaustive search: load all logs, find ALL instances.
 * If logs are too large for a single AI call, batch into chunks and merge.
 */
async function searchExhaustive(
  query: string,
  model: string,
  todayDate: string,
  today: Date,
) {
  const { logs, daysSearched } = await loadAllLogs(today);

  if (logs.length === 0) {
    return NextResponse.json({
      answer:
        "I couldn't find any work logs in the searched time period. There may not be any logs recorded for those dates.",
      daysSearched,
      exhausted: true,
      searchMode: 'exhaustive' as SearchMode,
    });
  }

  const totalChars = logs.reduce((sum, l) => sum + l.length, 0);
  const allUrls = await collectUrlsFromLogs(logs);
  const githubContext = await fetchGitHubContext(Array.from(allUrls));
  const systemPrompt = buildSystemPrompt(todayDate, 'exhaustive');

  if (totalChars <= MAX_SINGLE_SHOT_CHARS) {
    // Single-shot: all logs fit in one call
    const searchWindow = `Searching ALL available logs (${daysSearched} days)`;
    const userPrompt = buildUserPrompt(query, logs, githubContext, searchWindow);
    const result = await callCopilot(systemPrompt, userPrompt, model);

    const answer =
      result.trim() === NEED_MORE_CONTEXT
        ? "I searched through all available work logs but couldn't find information relevant to your question."
        : result;

    return NextResponse.json({
      answer,
      daysSearched,
      exhausted: true,
      searchMode: 'exhaustive' as SearchMode,
    });
  }

  // Batched: logs are too large, search in chunks and merge
  const partialFindings: string[] = [];
  for (let i = 0; i < logs.length; i += EXHAUSTIVE_CHUNK_DAYS) {
    const chunk = logs.slice(i, i + EXHAUSTIVE_CHUNK_DAYS);
    const chunkFirst = chunk[0].match(/^## (\d{4}-\d{2}-\d{2})/)?.[1] ?? '';
    const chunkLast = chunk[chunk.length - 1].match(/^## (\d{4}-\d{2}-\d{2})/)?.[1] ?? '';
    const searchWindow = `Searching logs from ${chunkFirst} to ${chunkLast} (batch ${Math.floor(i / EXHAUSTIVE_CHUNK_DAYS) + 1})`;

    const userPrompt = buildUserPrompt(query, chunk, githubContext, searchWindow);
    const result = await callCopilot(systemPrompt, userPrompt, model);

    if (result.trim() !== NEED_MORE_CONTEXT) {
      partialFindings.push(result);
    }
  }

  if (partialFindings.length === 0) {
    return NextResponse.json({
      answer:
        "I searched through all available work logs but couldn't find information relevant to your question.",
      daysSearched,
      exhausted: true,
      searchMode: 'exhaustive' as SearchMode,
    });
  }

  // Consolidation call to merge partial findings
  if (partialFindings.length === 1) {
    return NextResponse.json({
      answer: partialFindings[0],
      daysSearched,
      exhausted: true,
      searchMode: 'exhaustive' as SearchMode,
    });
  }

  const mergePrompt = `You were asked: "${query}"

Below are findings from searching different time periods of work logs. Merge them into a single comprehensive answer. Remove duplicates, keep chronological order, and preserve all unique instances.

${partialFindings.map((f, i) => `### Findings batch ${i + 1}\n${f}`).join('\n\n')}`;

  const merged = await callCopilot(
    buildSystemPrompt(todayDate, 'exhaustive'),
    mergePrompt,
    model,
  );

  return NextResponse.json({
    answer: merged,
    daysSearched,
    exhausted: true,
    searchMode: 'exhaustive' as SearchMode,
  });
}

/**
 * Date-bounded search: load only the specified date range and search once.
 */
async function searchDateBounded(
  query: string,
  model: string,
  todayDate: string,
  startDate: string,
  endDate: string,
) {
  const logs = await loadLogsForRange(startDate, endDate);
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  const daysSearched = Math.ceil(
    (end.getTime() - start.getTime()) / 86400000,
  ) + 1;

  if (logs.length === 0) {
    return NextResponse.json({
      answer: `I couldn't find any work logs between ${startDate} and ${endDate}.`,
      daysSearched,
      exhausted: true,
      searchMode: 'date_bounded' as SearchMode,
    });
  }

  const allUrls = await collectUrlsFromLogs(logs);
  const githubContext = await fetchGitHubContext(Array.from(allUrls));
  const searchWindow = `Searching from ${startDate} to ${endDate} (${daysSearched} days)`;
  const systemPrompt = buildSystemPrompt(todayDate, 'date_bounded');
  const userPrompt = buildUserPrompt(query, logs, githubContext, searchWindow);
  const result = await callCopilot(systemPrompt, userPrompt, model);

  const answer =
    result.trim() === NEED_MORE_CONTEXT
      ? `I searched logs from ${startDate} to ${endDate} but couldn't find information relevant to your question.`
      : result;

  return NextResponse.json({
    answer,
    daysSearched,
    exhausted: true,
    searchMode: 'date_bounded' as SearchMode,
  });
}

/**
 * Recent-first search: iterative windowed approach, stops on first answer.
 * This is the original search strategy, ideal for recency-biased queries.
 */
async function searchRecentFirst(
  query: string,
  model: string,
  todayDate: string,
  today: Date,
  offsetDays: number,
) {
  const allLogs: string[] = [];
  const allUrls = new Set<string>();
  let daysSearched = offsetDays;
  let answer: string | null = null;

  for (let iter = 0; iter < MAX_ITERATIONS_PER_REQUEST; iter++) {
    const windowEnd = new Date(today);
    windowEnd.setDate(windowEnd.getDate() - daysSearched);
    const windowStart = new Date(windowEnd);
    windowStart.setDate(windowStart.getDate() - WINDOW_SIZE + 1);

    const startStr = formatDate(windowStart);
    const endStr = formatDate(windowEnd);

    const newLogs = await loadLogsForRange(startStr, endStr);
    allLogs.push(...newLogs);
    daysSearched += WINDOW_SIZE;

    for (const log of newLogs) {
      const urls = await extractGitHubUrls(log);
      urls.forEach((u) => allUrls.add(u));
    }

    if (allLogs.length === 0 && daysSearched < MAX_LOOKBACK_DAYS) {
      continue;
    }

    if (allLogs.length === 0) {
      return NextResponse.json({
        answer:
          "I couldn't find any work logs in the searched time period. There may not be any logs recorded for those dates.",
        daysSearched,
        exhausted: true,
        searchMode: 'recent_first' as SearchMode,
      });
    }

    const githubContext = await fetchGitHubContext(Array.from(allUrls));
    const searchWindow = `Searching from ${formatDate(
      new Date(today.getTime() - daysSearched * 86400000),
    )} to ${todayDate} (${daysSearched} days)`;

    const systemPrompt = buildSystemPrompt(todayDate, 'recent_first');
    const userPrompt = buildUserPrompt(
      query,
      allLogs,
      githubContext,
      searchWindow,
    );

    const result = await callCopilot(systemPrompt, userPrompt, model);

    if (result.trim() === NEED_MORE_CONTEXT) {
      if (daysSearched >= MAX_LOOKBACK_DAYS) {
        return NextResponse.json({
          answer:
            "I searched through a full year of work logs but couldn't find information relevant to your question. The answer may not be in your recorded logs.",
          daysSearched,
          exhausted: true,
          searchMode: 'recent_first' as SearchMode,
        });
      }
      if (iter === MAX_ITERATIONS_PER_REQUEST - 1) {
        return NextResponse.json({
          answer: null,
          daysSearched,
          exhausted: false,
          searchMode: 'recent_first' as SearchMode,
        });
      }
      continue;
    }

    answer = result;
    break;
  }

  return NextResponse.json({
    answer:
      answer ??
      "I couldn't find information relevant to your question in the searched logs.",
    daysSearched,
    exhausted: daysSearched >= MAX_LOOKBACK_DAYS,
    searchMode: 'recent_first' as SearchMode,
  });
}

export async function POST(req: Request) {
  try {
    const { query, model, todayDate, offsetDays = 0 } = await req.json();

    if (!query || !todayDate) {
      return NextResponse.json(
        { error: 'Missing query or todayDate' },
        { status: 400 },
      );
    }

    const today = new Date(todayDate + 'T12:00:00');

    // Classify the query to determine optimal search strategy
    const classification = await classifySearchQuery(query, todayDate, model);

    switch (classification.mode) {
      case 'exhaustive':
        return searchExhaustive(query, model, todayDate, today);

      case 'date_bounded': {
        const startDate =
          classification.startDate ?? formatDate(new Date(today.getTime() - 14 * 86400000));
        const endDate = classification.endDate ?? todayDate;

        // Validate dates and handle inverted ranges
        const parsedStart = new Date(startDate + 'T00:00:00');
        const parsedEnd = new Date(endDate + 'T00:00:00');
        if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
          // Invalid dates from classifier — fall back to recent_first
          return searchRecentFirst(query, model, todayDate, today, offsetDays);
        }
        const resolvedStart = parsedStart <= parsedEnd ? startDate : endDate;
        const resolvedEnd = parsedStart <= parsedEnd ? endDate : startDate;
        return searchDateBounded(query, model, todayDate, resolvedStart, resolvedEnd);
      }

      case 'recent_first':
      default:
        return searchRecentFirst(query, model, todayDate, today, offsetDays);
    }
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Failed to perform search' },
      { status: 500 },
    );
  }
}
