# Slack Thread-Context Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Daily Activity "messages I sent" Slack summary meaningful by giving the summarizer the real surrounding conversation (full thread, or a small before/after window for standalone messages) instead of only the isolated line I sent — and fix a pre-existing Slack mrkdwn link bug (`<url|label>`) along the way.

**Architecture:** A new, independently-testable module (`src/lib/slackThreadContext.ts`) owns everything about resolving "what's the real context around this message" — thread detection (via `conversations.replies`), full-thread fetch, standalone before/after fetch (via `conversations.history`), a per-run dedup cache, a per-run 150-call enrichment budget, and cached user-name resolution. `src/lib/dailyActivity.ts` gets a thin new renderer (`renderEnrichedSlackFacts`) that calls into this module per matched message and falls back to the existing, untouched `renderSlackFacts` for anything that fails or when Slack user-ID resolution isn't available at all — so today's behavior is preserved byte-for-byte whenever enrichment can't run.

**Tech Stack:** Next.js / TypeScript, `gh slack api get <method>` (gh-slack CLI extension) for all Slack calls (`search.messages`, `conversations.replies`, `conversations.history`, `users.info`, `auth.test`), `@github/copilot-sdk` for the summarization prompt. No test runner is configured in this repo — verification is `npm run build` + `npm run lint` plus manual checks against the real Slack workspace via one-off `gh slack api` / `node -e` calls (the same approach used throughout this feature's design phase), in place of unit tests.

---

## Design reference

Full approved design: `docs/superpowers/specs/2026-07-07-slack-thread-context-design.md`. This plan implements that spec exactly, with one refinement made explicit during planning: thread "already fully fetched" detection continues to use the `conversations.replies` response-length check (>1 message = already the full thread), and thread-grouping in the renderer is keyed by the *authoritative* thread root `ts` discovered during enrichment (not the unreliable `thread_ts` field from `search.messages`), which is what makes deduping multiple own-messages-in-the-same-thread correct.

## File structure

- **Create:** `src/lib/slackThreadContext.ts` — new, self-contained module: `cleanSlackText`, `ContextLine` type, `EnrichmentContext` type + `createEnrichmentContext()`, and the single exported orchestration function `getMessageContext()`. This is split out (rather than added to `dailyActivity.ts`, already 756 lines) because it's a well-bounded subsystem with one clear interface and its own internal state (dedup cache, budget, name cache) — exactly the kind of unit that's easier to reason about and verify in isolation.
- **Modify:** `src/lib/dailyActivity.ts` — add `channelId` to `SlackMessage`, capture it + apply `cleanSlackText` in `searchSlackMessages`, apply `cleanSlackText` in `searchSlackMentions`, add `renderEnrichedSlackFacts()`, update `buildSummaryPrompt()`'s instructions, wire it all into `fetchSlackSummary()`, update the top-of-file doc comment.
- **Modify:** `README.md` — mention the enriched context in the Daily Activity feature bullet.
- **Modify:** `CHANGELOG.md` — add a dated entry describing the user-visible improvement.

---

### Task 1: Slack text normalization (`cleanSlackText`) + apply everywhere

**Files:**
- Create: `src/lib/slackThreadContext.ts`
- Modify: `src/lib/dailyActivity.ts:290` (search.messages match type in `searchSlackMessages`)
- Modify: `src/lib/dailyActivity.ts:313` (message push in `searchSlackMessages`)
- Modify: `src/lib/dailyActivity.ts:393` (message push in `searchSlackMentions`)

- [ ] **Step 1: Create the new module with just the text-cleaning helper**

Create `src/lib/slackThreadContext.ts`:

```ts
/**
 * Support for enriching a matched Slack message with its real surrounding
 * conversation (full thread, or a small before/after window for standalone
 * messages), so the Daily Activity Slack summarizer sees more than just the
 * one isolated line I sent. See docs/superpowers/specs/2026-07-07-slack-thread-context-design.md
 * for the full design.
 */

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
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/tali/git-stuff-done && npx tsc --noEmit -p tsconfig.json 2>&1 | grep slackThreadContext`
Expected: no output (no errors reference the new file).

- [ ] **Step 3: Manually verify the regex against real Slack text shapes**

Run: `node -e '
function cleanSlackText(raw) {
  return raw
    .replace(/<([^<>|]+)\|[^<>]*>/g, "$1")
    .replace(/<([^<>]+)>/g, "$1");
}
console.log(cleanSlackText("see <https://github.com/github/licensing/issues/4572|github.com/github/licensing/issues/4572> for details"));
console.log(cleanSlackText("bare autolink <https://github.com/github/datadog-monitoring/pull/54300/>"));
console.log(cleanSlackText("no links here"));
'`

Expected output (three lines):
```
see https://github.com/github/licensing/issues/4572 for details
bare autolink https://github.com/github/datadog-monitoring/pull/54300/
no links here
```

- [ ] **Step 4: Apply `cleanSlackText` in `searchSlackMessages` and add `channelId` capture**

In `src/lib/dailyActivity.ts`, update the match type and the two lines that build `SlackMessage` objects.

First, add the import near the top (after the existing imports around line 47):

```ts
import { fetchGitHubActivity, extractGitHubUrls, fetchLinkInfo, type GitHubActivity, type GitHubLinkInfo } from "./github";
import { cleanSlackText } from "./slackThreadContext";
```

Then update the `SlackMessage` type (currently at line 258):

```ts
type SlackMessage = { channel: string; channelId?: string; text: string; ts: string; permalink?: string; threadTs?: string; author?: string };
```

Then in `searchSlackMessages`, update the match type (line 290) to capture `channel.id`:

```ts
      messages?: { matches?: Array<{ channel?: { id?: string; name?: string; is_private?: boolean }; text?: string; ts?: string; permalink?: string; thread_ts?: string }> };
```

And update the push (line 313) to include `channelId` and clean the text:

```ts
      messages.push({
        channel: m.channel.name,
        channelId: m.channel.id,
        text: cleanSlackText(m.text ?? ""),
        ts: m.ts,
        permalink: m.permalink,
        threadTs: m.thread_ts,
      });
```

- [ ] **Step 5: Apply `cleanSlackText` in `searchSlackMentions`**

In `searchSlackMentions` (around line 391), update the push to clean the text (mentions are explicitly out of scope for context enrichment, but still get the link-normalization fix per the "fix everywhere" decision):

```ts
      messages.push({
        channel: channelLabel,
        text: cleanSlackText(m.text ?? ""),
        ts: m.ts,
        permalink: m.permalink,
        threadTs: m.thread_ts,
        author: m.username,
      });
```

- [ ] **Step 6: Build and lint**

Run: `cd /Users/tali/git-stuff-done && npm run build`
Expected: build succeeds with no TypeScript errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/slackThreadContext.ts src/lib/dailyActivity.ts
git commit -m "feat: normalize Slack mrkdwn links wherever Slack text is captured"
```

---

### Task 2: Enrichment context types, dedup cache, budget, and name resolution

**Files:**
- Modify: `src/lib/slackThreadContext.ts`

- [ ] **Step 1: Add the types and per-run context factory**

Append to `src/lib/slackThreadContext.ts`:

```ts
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

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
```

- [ ] **Step 2: Build**

Run: `cd /Users/tali/git-stuff-done && npm run build`
Expected: succeeds (the new exports aren't used anywhere yet, so no "unused" errors since they're exported; `resolveUserName` is used in Task 3+).

- [ ] **Step 3: Commit**

```bash
git add src/lib/slackThreadContext.ts
git commit -m "feat: add enrichment context (dedup cache, budget, name resolution)"
```

---

### Task 3: Raw Slack API helpers + transcript building

**Files:**
- Modify: `src/lib/slackThreadContext.ts`

- [ ] **Step 1: Add `conversations.replies` / `conversations.history` wrappers and transcript conversion**

Append to `src/lib/slackThreadContext.ts`:

```ts
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
```

- [ ] **Step 2: Build**

Run: `cd /Users/tali/git-stuff-done && npm run build`
Expected: succeeds.

- [ ] **Step 3: Manually verify against the live Slack workspace**

First authenticate (adjust team if `SLACK_TEAM`/`GITHUB_ORG` differ):
```bash
eval $(gh slack auth -t github)
```

Then confirm a real thread-root call returns the full thread in one shot (the "already full thread" optimization):
```bash
gh slack api get conversations.replies -t github -f channel=C0B29M6BJ0N -f ts=1783566237.009689 | node -e '
let data=""; process.stdin.on("data", d => data += d); process.stdin.on("end", () => {
  const parsed = JSON.parse(data);
  console.log("message count:", parsed.messages.length);
  console.log("first message thread_ts === ts:", parsed.messages[0].thread_ts === parsed.messages[0].ts);
});'
```
Expected: `message count: 2` (or more) and `first message thread_ts === ts: true` — confirming this response already IS the full thread, no second call needed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/slackThreadContext.ts
git commit -m "feat: add raw conversations.replies/history helpers and transcript building"
```

---

### Task 4: `getMessageContext` orchestration + end-to-end verification

**Files:**
- Modify: `src/lib/slackThreadContext.ts`

- [ ] **Step 1: Add the exported orchestration function**

Append to `src/lib/slackThreadContext.ts`:

```ts
/**
 * Resolve context (the full thread, or a small before/after window) for one
 * matched message.
 *
 * Returns `null` if enrichment couldn't be attempted (API failure or the
 * per-run call budget is exhausted) — the caller should fall back to
 * rendering today's plain single-line fact for just this message.
 *
 * Returns `{ isNewGroup: false, ... }` if this message's thread was already
 * fully resolved by an earlier call in this run (e.g. two of my own
 * messages landed in the same thread) — the caller should skip rendering a
 * duplicate bullet for it, since it's already represented in the earlier
 * result's `lines`.
 */
export async function getMessageContext(
  ctx: EnrichmentContext,
  team: string,
  channelId: string,
  ts: string,
  myUserId: string,
): Promise<MessageContextResult | null> {
  const knownRoot = ctx.resolvedTs.get(ts);
  if (knownRoot) {
    return { threadRootTs: knownRoot, isNewGroup: false, lines: ctx.resolvedGroups.get(knownRoot) ?? [] };
  }

  const detected = await callConversationsReplies(ctx, team, channelId, ts);
  if (detected === null) return null;

  if (detected.length > 1) {
    // `ts` was itself the thread root — this response IS the full thread already.
    return finalizeThread(ctx, detected, ts, team, myUserId);
  }

  const single = detected[0];
  const threadTs = single?.thread_ts;
  if (!threadTs || threadTs === ts) {
    // Standalone message (not part of any thread): fetch a small window of
    // surrounding channel history for context instead.
    const [before, after] = await Promise.all([
      callConversationsHistory(ctx, team, channelId, { latest: ts }, 3),
      callConversationsHistory(ctx, team, channelId, { oldest: ts }, 3),
    ]);
    if (before === null || after === null) return null;
    const raw = [...before, ...(single ? [single] : []), ...after];
    const lines = await toContextLines(ctx, raw, team, myUserId);
    ctx.resolvedTs.set(ts, ts);
    ctx.resolvedGroups.set(ts, lines);
    return { threadRootTs: ts, isNewGroup: true, lines };
  }

  // A reply to a real thread whose root wasn't returned directly — fetch the
  // whole thread from its actual root.
  const full = await callConversationsReplies(ctx, team, channelId, threadTs);
  if (full === null) return null;
  return finalizeThread(ctx, full, threadTs, team, myUserId);
}
```

- [ ] **Step 2: Build and lint**

Run: `cd /Users/tali/git-stuff-done && npm run build && npm run lint`
Expected: both succeed with no errors.

- [ ] **Step 3: Manually verify `getMessageContext` end-to-end against the live workspace**

```bash
eval $(gh slack auth -t github)
cd /Users/tali/git-stuff-done
npx tsx -e '
import { createEnrichmentContext, getMessageContext } from "./src/lib/slackThreadContext";

async function main() {
  const ctx = createEnrichmentContext();
  // A real thread root from this workspace (from Task 3 verification).
  const result = await getMessageContext(ctx, "github", "C0B29M6BJ0N", "1783566237.009689", "U02J8PQ5M43");
  console.log(JSON.stringify(result, null, 2));
}
main();
' 2>&1 | head -50
```
(If `tsx` isn't available, use `npx ts-node` or compile-and-run via `node --experimental-strip-types` depending on what's already used elsewhere in the repo for ad hoc TS scripts — check `package.json` devDependencies first.)

Expected: prints a `MessageContextResult` with `isNewGroup: true`, `threadRootTs: "1783566237.009689"`, and a `lines` array where the first entry has `author: "You"` and the second entry has a resolved human name (not a raw `U...` ID) for `U03UBSLFPL7`.

- [ ] **Step 4: Verify budget/cap behavior with a quick inline check**

```bash
node -e '
// Simulates budget exhaustion: after 150 decrements, calls should short-circuit.
let budget = 150;
for (let i = 0; i < 150; i++) budget--;
console.log("budget after 150 calls:", budget, "-> next call would return null:", budget <= 0);
'
```
Expected: `budget after 150 calls: 0 -> next call would return null: true`

- [ ] **Step 5: Commit**

```bash
git add src/lib/slackThreadContext.ts
git commit -m "feat: add getMessageContext orchestration for thread/context resolution"
```

---

### Task 5: Wire enrichment into `dailyActivity.ts`

**Files:**
- Modify: `src/lib/dailyActivity.ts:1-43` (top doc comment)
- Modify: `src/lib/dailyActivity.ts:44-49` (imports)
- Modify: `src/lib/dailyActivity.ts` (new `renderEnrichedSlackFacts` function, placed after the existing `renderMentionFacts`)
- Modify: `src/lib/dailyActivity.ts:487-505` (`buildSummaryPrompt`)
- Modify: `src/lib/dailyActivity.ts:582-619` (`fetchSlackSummary`)

- [ ] **Step 1: Extend the import from Task 1 to bring in the new orchestration pieces**

Update the import added in Task 1:

```ts
import { cleanSlackText, createEnrichmentContext, getMessageContext } from "./slackThreadContext";
```

- [ ] **Step 2: Add `renderEnrichedSlackFacts`, placed right after `renderMentionFacts` (after line 484)**

```ts
/**
 * Render the raw Slack messages I sent, grouped by channel, using real
 * thread/context enrichment where available (see slackThreadContext.ts):
 * each thread is rendered as a labeled transcript ("You:" for my own lines,
 * the other participant's name otherwise) instead of just my isolated
 * line(s). Messages whose enrichment failed or exceeded the per-run call
 * budget fall back to being rendered exactly like `renderSlackFacts` (my
 * own line only, no author label), grouped by the legacy `threadKey()`
 * heuristic. Messages that turn out to belong to an already-rendered
 * thread (e.g. two of my own messages landed in the same thread) are
 * skipped — they're already represented in that thread's transcript.
 */
async function renderEnrichedSlackFacts(messages: SlackMessage[], team: string, myUserId: string): Promise<string> {
  if (messages.length === 0) return "(no public Slack messages found)";
  const byChannel = new Map<string, SlackMessage[]>();
  for (const m of messages) {
    const arr = byChannel.get(m.channel) ?? [];
    arr.push(m);
    byChannel.set(m.channel, arr);
  }

  const ctx = createEnrichmentContext();
  const lines: string[] = [];
  for (const [channel, msgs] of byChannel) {
    lines.push(`#${channel}:`);
    let threadNum = 1;
    const fallback: SlackMessage[] = [];

    for (const m of msgs) {
      if (!m.channelId) {
        fallback.push(m);
        continue;
      }
      const result = await getMessageContext(ctx, team, m.channelId, m.ts, myUserId);
      if (result === null) {
        fallback.push(m);
        continue;
      }
      if (!result.isNewGroup) continue; // already rendered as part of an earlier message's thread

      lines.push(`  Thread ${threadNum}${m.permalink ? ` (link: ${m.permalink})` : ""}:`);
      for (const line of result.lines) {
        const text = line.text.replace(/\s+/g, " ").trim().slice(0, 300);
        const prefix = line.author ? `${line.author}: ` : "";
        lines.push(`  - ${prefix}${text || "(no text, e.g. a file/attachment)"}`);
      }
      threadNum++;
    }

    // Fallback: messages enrichment couldn't resolve, grouped and rendered
    // exactly like today's plain behavior (own line only, no author label).
    const byThread = new Map<string, SlackMessage[]>();
    for (const m of fallback) {
      const arr = byThread.get(threadKey(m)) ?? [];
      arr.push(m);
      byThread.set(threadKey(m), arr);
    }
    for (const [, threadMsgs] of byThread) {
      const permalink = threadMsgs.find((m) => m.permalink)?.permalink;
      lines.push(`  Thread ${threadNum}${permalink ? ` (link: ${permalink})` : ""}:`);
      for (const m of threadMsgs.slice(0, 20)) {
        const text = m.text.replace(/\s+/g, " ").trim().slice(0, 300);
        lines.push(`  - ${text || "(no text, e.g. a file/attachment)"}`);
      }
      threadNum++;
    }
  }
  return lines.join("\n");
}
```

- [ ] **Step 3: Update `buildSummaryPrompt`'s instructions for the new transcript format**

Replace the current `buildSummaryPrompt` (lines 487–505) with:

```ts
/** Build the prompt that asks the model to summarize already-gathered Slack facts. */
function buildSummaryPrompt(date: string, slackFacts: string): string {
  return `You are generating the Slack portion of the end-of-day activity log for ${date} (timezone America/Los_Angeles).

Below are Slack conversations from ${date} involving messages I sent, grouped by channel and then by thread (already collected — do not search for more, just summarize what's given). Where available, each thread shows the full surrounding conversation, not just my own lines: my own messages are labeled "You:", other participants' messages are labeled with their name and are given only as context to help you understand what I was responding to or discussing — do not summarize their activity as if it were mine. Some threads may only show my own message(s) with no other labels, if fuller context wasn't available; treat those exactly as you would a single isolated message.

Produce a response in exactly this format, with no preamble:

SLACK:
<for each channel below that has messages, a "**#channel-name**" heading line, followed by one top-level bullet ("- ") per thread in that channel. Each thread bullet must:
- Summarize and reason about what I ("You") said or did in the thread — e.g. was I asking a question, answering one, reporting a bug, proposing a decision, giving a status update? Use any other participants' messages only to understand the context; do not summarize their activity as if it were mine.
- Cite concrete specifics (names, PR/issue links, error messages, decisions) rather than vague generalities like "discussed some issues".
- End with a markdown link to the thread using its "link:" value from the facts below, formatted as "([view thread](<link>))". Omit this if no link was given for that thread.
- Use plain, professional language. Do not use emoji — this is a factual activity log, not a chat message, so emoji would look out of place even if my original messages used them.
If a thread has multiple related sub-points, use nested "  - " bullets under the thread bullet instead of cramming everything into one sentence.
If there are no Slack messages below, output exactly "_No public Slack activity._">

Slack conversations for the day, grouped by channel and thread:
${slackFacts}`;
}
```

- [ ] **Step 4: Wire enrichment into `fetchSlackSummary`**

Replace the current `fetchSlackSummary` (lines 582–619) with:

```ts
/**
 * Search Slack (via gh-slack) for the day's public messages, resolve real
 * thread/context enrichment where possible (see slackThreadContext.ts), then
 * call Copilot with a plain (non-tool-calling) prompt to produce the
 * per-channel Slack summary. Returns a graceful fallback on any failure.
 */
async function fetchSlackSummary(date: string): Promise<SlackResult> {
  const messages = await searchSlackMessages(date);
  if (messages === null) {
    return { slackSection: "_Slack summary unavailable._" };
  }

  const team = slackTeam();
  const myUserId = team ? await getSlackUserId(team) : null;
  const slackFacts =
    team && myUserId ? await renderEnrichedSlackFacts(messages, team, myUserId) : renderSlackFacts(messages);

  const client = new CopilotClient();
  try {
    const session = await withTimeout(
      client.createSession({
        model: SLACK_MODEL,
        onPermissionRequest: async () => ({ kind: "approved" as const }),
      }),
      30_000,
      "createSession",
    );
    const res = await session.sendAndWait(
      { prompt: buildSummaryPrompt(date, slackFacts) },
      120_000,
    );
    const content = res?.data?.content ?? "";
    const parsed = parseSlackResponse(content);
    return { slackSection: await formatBulletSection(parsed.slackSection) };
  } catch (e) {
    console.error("[dailyActivity] fetchSlackSummary failed:", e);
    return { slackSection: "_Slack summary unavailable._" };
  } finally {
    try {
      await withTimeout(client.stop(), 10_000, "client.stop");
    } catch {
      try {
        await client.forceStop();
      } catch (e) {
        console.error("[dailyActivity] forceStop failed:", e);
      }
    }
  }
}
```

- [ ] **Step 5: Update the top-of-file doc comment**

In the doc comment (lines 1–43), replace this paragraph:

```
 * This calls Slack's real `search.messages` Web API (via the user's own
 * Slack session, same auth `gh-slack` already uses) and reliably returns
 * every message the authenticated user sent that day, with channel name,
 * privacy flag, and timestamp. Results are filtered to `is_private === false`
 * channels and to messages whose timestamp actually falls on the requested
 * date in America/Los_Angeles (defense in depth beyond Slack's own `on:`
 * search operator). Only the found messages are then handed to a plain
 * (non-tool-calling) Copilot SDK prompt to write a per-channel bullet-point
 * summary — the AI's job is summarization only, not searching.
```

with:

```
 * This calls Slack's real `search.messages` Web API (via the user's own
 * Slack session, same auth `gh-slack` already uses) and reliably returns
 * every message the authenticated user sent that day, with channel name,
 * privacy flag, and timestamp. Results are filtered to `is_private === false`
 * channels and to messages whose timestamp actually falls on the requested
 * date in America/Los_Angeles (defense in depth beyond Slack's own `on:`
 * search operator).
 *
 * Each matched message is then enriched with its real surrounding
 * conversation (see src/lib/slackThreadContext.ts) rather than being
 * summarized in isolation: a `conversations.replies` call detects whether
 * it's part of a real thread (fetching the full thread, capped at 20
 * messages) or standalone (fetching a small before/after window of channel
 * history via `conversations.history` instead). This is capped at 150
 * enrichment API calls per run and gracefully falls back to the old
 * isolated-line rendering for anything that fails or exceeds the cap. Slack
 * mrkdwn link syntax (`<url|label>`, `<url>`) is normalized to bare URLs
 * wherever Slack text is captured, so the app's linkification helpers can
 * find and format GitHub PR/issue links correctly. Only the resulting
 * per-thread transcripts are then handed to a plain (non-tool-calling)
 * Copilot SDK prompt to write a per-channel bullet-point summary — the AI's
 * job is summarization only, not searching.
```

- [ ] **Step 6: Build and lint**

Run: `cd /Users/tali/git-stuff-done && npm run build && npm run lint`
Expected: both succeed with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/dailyActivity.ts
git commit -m "feat: enrich Slack summary threads with real context"
```

---

### Task 6: End-to-end verification and docs

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: End-to-end manual verification against the live workspace**

```bash
eval $(gh slack auth -t github)
```

Since `fetchSlackSummary` isn't exported (it's internal), verify indirectly: run the app's existing daily-activity generation path for a recent date that has real Slack activity (check what script/route triggers `generateDailyActivityImpl`, e.g. via the scheduler or an API route under `src/app/api/`) and inspect the resulting log file under `logs/YYYY-MM-DD.md` for:
- A `### Slack` section where at least one thread shows multiple labeled lines (e.g. "You: ..." followed by "<Name>: ...") rather than just a single unlabeled line.
- No raw `<https://...|...>` Slack mrkdwn syntax anywhere in the output — only bare URLs or fully-formatted markdown links.
- The generation completes without throwing (check server/console logs for `[dailyActivity]` error lines).

Expected: at least one enriched multi-line thread appears, and no raw `<url|label>` syntax survives into the log.

- [ ] **Step 2: Update `README.md`**

Find the Daily Activity feature description in `README.md` and add a short clause noting the summary now includes real thread context. Locate the relevant bullet/section first:

```bash
grep -n "Slack" README.md
```

Add a sentence such as: "The Slack summary includes the real surrounding conversation for each thread (not just the message you sent), so the summary better reflects what was actually being discussed."

- [ ] **Step 3: Add a `CHANGELOG.md` entry**

Under today's date heading (create one if it doesn't exist), add:

```markdown
### Changed
- The Slack activity summary now includes the real conversation around each message you sent (the rest of the thread, or nearby messages for standalone ones), instead of just your isolated line, so summaries better reflect what was actually discussed.

### Fixed
- Slack messages containing links no longer show broken/garbled formatting in the activity log.
```

- [ ] **Step 4: Final build and lint**

Run: `cd /Users/tali/git-stuff-done && npm run build && npm run lint`
Expected: both succeed with no errors.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document Slack thread-context enrichment"
```

---

## Self-review notes

- **Spec coverage:** `cleanSlackText` (Task 1), thread detection incl. "already full thread" optimization (Task 4), full-thread fetch capped at 20 (Task 3's `finalizeThread`), standalone before/after fetch limit 3 (Task 4), dedup cache (Task 2/3), name resolution cache (Task 2), 150-call budget (Task 2/3), rendering with "You:"/name labels and graceful per-item fallback (Task 5), prompt updates (Task 5), Mentions section left untouched (no task modifies `searchSlackMentions`'s matching/grouping logic or `renderMentionFacts`/`buildMentionsSummaryPrompt`, only its text-cleaning per Task 1 Step 5) — all covered.
- **Placeholder scan:** no TBD/TODO markers; every step has complete, runnable code.
- **Type consistency:** `SlackMessage.channelId` (Task 1) is read in `renderEnrichedSlackFacts` (Task 5); `EnrichmentContext`/`ContextLine`/`MessageContextResult` (Task 2) are used consistently by `getMessageContext` (Task 4) and `renderEnrichedSlackFacts` (Task 5); `cleanSlackText`/`createEnrichmentContext`/`getMessageContext` are the only three symbols imported from `slackThreadContext.ts` into `dailyActivity.ts`, matching their `export` declarations.
