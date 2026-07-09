/**
 * Support for enriching a matched Slack message with its real surrounding
 * conversation (full thread, or a small before/after window for standalone
 * messages), so the Daily Activity Slack summarizer sees more than just the
 * one isolated line I sent. See docs/superpowers/specs/2026-07-07-slack-thread-context-design.md
 * for the full design.
 */
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Normalize Slack mrkdwn link syntax to a bare URL. Slack's raw message
 * `text` field renders links as `<url|label>` (link with a display label)
 * or `<url>` (bare autolink) rather than a plain URL — the `<url|label>`
 * form is NOT handled correctly by the app's existing linkification helpers
 * (`applyLinkification` in src/lib/copilot.ts only understands bare URLs and
 * label-less `<url>` autolinks), so any Slack text captured anywhere in this
 * app must be run through this first, before it reaches the model or any
 * linkify step.
 */
export function cleanSlackText(raw: string): string {
  return raw
    .replace(/<([^<>|]+)\|[^<>]*>/g, "$1") // <url|label> -> url
    .replace(/<([^<>]+)>/g, "$1"); // <url> -> url
}

/** One line in an enriched thread/context transcript, in chronological order. */
export type ContextLine = { author: string; text: string; ts: string; isMe: boolean };

/** Result of resolving context for one matched message. */
export type MessageContextResult = {
  /** The authoritative thread root `ts` (or the message's own `ts` if standalone). Used for dedup. */
  threadRootTs: string;
  /** True the first time this `threadRootTs` is resolved during this run; false for later messages found to share it (caller should skip re-rendering them — they're already represented in the first result's `lines`). */
  isNewGroup: boolean;
  /** Chronological transcript: the full thread (capped) or a small window around a standalone message. */
  lines: ContextLine[];
};

/** Per-run state: dedup cache, name-resolution cache, and the shared enrichment call budget. Create one via `createEnrichmentContext()` per `fetchSlackSummary` run. */
export type EnrichmentContext = {
  /** Maps every message `ts` seen so far to the thread root `ts` it belongs to. */
  resolvedTs: Map<string, string>;
  /** Maps a thread root `ts` to its already-fetched transcript, so repeat matches in the same thread skip re-fetching. */
  resolvedGroups: Map<string, ContextLine[]>;
  /** Slack user ID -> resolved display name (or the ID itself if lookup failed). */
  names: Map<string, string>;
  /** Remaining enrichment API calls allowed this run (detection + thread-fetch + history-fetch combined; name-resolution calls don't count against this). */
  budget: number;
};

const MAX_ENRICHMENT_CALLS = 150;
const MAX_THREAD_MESSAGES = 20;

/** Create a fresh per-run enrichment context (call once per `fetchSlackSummary` invocation). */
export function createEnrichmentContext(): EnrichmentContext {
  return {
    resolvedTs: new Map(),
    resolvedGroups: new Map(),
    names: new Map(),
    budget: MAX_ENRICHMENT_CALLS,
  };
}

/** Resolve a Slack user ID to a display name via `users.info`, cached per run. Falls back to the raw ID on any failure (name resolution failures shouldn't drop the transcript line, just show a less-friendly label). */
async function resolveUserName(ctx: EnrichmentContext, userId: string, team: string): Promise<string> {
  const cached = ctx.names.get(userId);
  if (cached) return cached;
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["slack", "api", "get", "users.info", "-t", team, "-f", `user=${userId}`],
      { env: { ...process.env, NO_COLOR: "1" }, maxBuffer: 1024 * 1024 },
    );
    const data = JSON.parse(stdout) as { ok?: boolean; user?: { real_name?: string; name?: string } };
    const name = data.ok ? data.user?.real_name || data.user?.name || userId : userId;
    ctx.names.set(userId, name);
    return name;
  } catch (e) {
    console.error("[slackThreadContext] resolveUserName failed:", e instanceof Error ? e.message : e);
    ctx.names.set(userId, userId);
    return userId;
  }
}

type RawSlackMessage = { user?: string; text?: string; ts?: string; thread_ts?: string };

/** Call `conversations.replies` for one channel/ts pair. Returns the raw `messages` array, or `null` on failure or if the enrichment budget is exhausted. Consumes one unit of `ctx.budget`. */
async function callConversationsReplies(
  ctx: EnrichmentContext,
  team: string,
  channelId: string,
  ts: string,
): Promise<RawSlackMessage[] | null> {
  if (ctx.budget <= 0) return null;
  ctx.budget--;
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["slack", "api", "get", "conversations.replies", "-t", team, "-f", `channel=${channelId}`, "-f", `ts=${ts}`],
      { env: { ...process.env, NO_COLOR: "1" }, maxBuffer: 5 * 1024 * 1024 },
    );
    const data = JSON.parse(stdout) as { ok?: boolean; messages?: RawSlackMessage[] };
    if (!data.ok || !data.messages) return null;
    return data.messages;
  } catch (e) {
    console.error("[slackThreadContext] conversations.replies failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Call `conversations.history` for one channel, bounded before (`latest`) or after (`oldest`) a given `ts`. Returns the raw `messages` array, or `null` on failure or if the budget is exhausted. Consumes one unit of `ctx.budget`. */
async function callConversationsHistory(
  ctx: EnrichmentContext,
  team: string,
  channelId: string,
  bound: { latest: string } | { oldest: string },
  limit: number,
): Promise<RawSlackMessage[] | null> {
  if (ctx.budget <= 0) return null;
  ctx.budget--;
  try {
    const boundField = "latest" in bound ? `latest=${bound.latest}` : `oldest=${bound.oldest}`;
    const { stdout } = await execFileAsync(
      "gh",
      [
        "slack", "api", "get", "conversations.history", "-t", team,
        "-f", `channel=${channelId}`, "-f", boundField, "-f", `limit=${limit}`, "-f", "inclusive=false",
      ],
      { env: { ...process.env, NO_COLOR: "1" }, maxBuffer: 5 * 1024 * 1024 },
    );
    const data = JSON.parse(stdout) as { ok?: boolean; messages?: RawSlackMessage[] };
    if (!data.ok || !data.messages) return null;
    return data.messages;
  } catch (e) {
    console.error("[slackThreadContext] conversations.history failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Convert raw Slack messages (any order) into chronological, name-resolved, cleaned `ContextLine`s. */
async function toContextLines(
  ctx: EnrichmentContext,
  raw: RawSlackMessage[],
  team: string,
  myUserId: string,
): Promise<ContextLine[]> {
  const sorted = [...raw].sort((a, b) => parseFloat(a.ts ?? "0") - parseFloat(b.ts ?? "0"));
  const lines: ContextLine[] = [];
  for (const m of sorted) {
    if (!m.ts || !m.user) continue;
    const isMe = m.user === myUserId;
    const author = isMe ? "You" : await resolveUserName(ctx, m.user, team);
    lines.push({ author, text: cleanSlackText(m.text ?? ""), ts: m.ts, isMe });
  }
  return lines;
}

/** Cap a resolved thread to `MAX_THREAD_MESSAGES` (root + most recent replies), resolve names, and populate the dedup cache for every message `ts` it contains so later matches in the same thread are skipped. */
async function finalizeThread(
  ctx: EnrichmentContext,
  raw: RawSlackMessage[],
  rootTs: string,
  team: string,
  myUserId: string,
): Promise<MessageContextResult> {
  const sorted = [...raw].sort((a, b) => parseFloat(a.ts ?? "0") - parseFloat(b.ts ?? "0"));
  let capped = sorted;
  let omitted = 0;
  if (sorted.length > MAX_THREAD_MESSAGES && sorted.length > 0) {
    const root = sorted[0];
    const recent = sorted.slice(-(MAX_THREAD_MESSAGES - 1));
    capped = [root, ...recent];
    omitted = sorted.length - capped.length;
  }
  const lines = await toContextLines(ctx, capped, team, myUserId);
  if (omitted > 0) {
    lines.splice(1, 0, { author: "", text: `…(${omitted} earlier replies omitted)…`, ts: rootTs, isMe: false });
  }
  for (const m of sorted) {
    if (m.ts) ctx.resolvedTs.set(m.ts, rootTs);
  }
  ctx.resolvedGroups.set(rootTs, lines);
  return { threadRootTs: rootTs, isNewGroup: true, lines };
}
