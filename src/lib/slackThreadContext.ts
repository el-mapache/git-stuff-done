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
