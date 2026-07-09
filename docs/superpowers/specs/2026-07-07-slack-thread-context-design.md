# Slack thread context for the Daily Activity "messages I sent" summary

## Motivation

The Daily Activity Slack summary (`fetchSlackSummary` in `src/lib/dailyActivity.ts`)
currently feeds the AI summarizer only the isolated text of each message you
personally sent that day (from `search.messages`). The model never sees what
anyone else said before or after — so it can only *guess* at why you said
something, rather than reasoning from the actual conversation. This feature
enriches each matched message with real surrounding context (the rest of its
thread, or nearby channel messages if it's standalone) so the resulting
summary can cite what was actually being discussed.

## Goals

- For each message you sent that's part of a Slack thread, fetch the full
  thread (capped) so the summarizer can see the whole conversation.
- For standalone (non-threaded) messages, fetch a few surrounding channel
  messages for context.
- Keep this reliable and cheap enough to run unattended every evening:
  degrade gracefully on any failure, and cap total extra API calls per day.
- Fix a related pre-existing bug: raw Slack message text uses mrkdwn link
  syntax (`<url>` / `<url|label>`), which the existing linkify
  post-processing doesn't fully handle and can mangle. Normalize this to
  bare URLs wherever Slack text is captured, so GitHub PR/issue links
  reliably survive into the final linkified summary.

## Non-goals

- The **Mentions** section (`fetchMentionsSummary`/`searchSlackMentions`) is
  unchanged. It keeps today's single-message-only behavior. Context
  enrichment there can be a separate follow-up if useful later.
- No config/UI changes — this is fully automatic, no new settings.
- No attempt at sophisticated rate-limit backoff/retry. On error, we simply
  skip enrichment for that item and fall back to today's plain behavior.

## Data model changes

`SlackMessage` (existing type) gains a `channelId?: string` field, populated
from `m.channel.id` in `searchSlackMessages` (already present in the raw
`search.messages` response, just not currently captured). This is required
to call `conversations.replies`/`conversations.history`, which need a
channel ID, not a channel name.

New type:

```ts
type ContextLine = { author: string; text: string; ts: string; isMe: boolean };
```

Represents one line in an enriched transcript: a resolved display name (or
raw user ID if resolution fails), cleaned message text, its timestamp, and
whether it's a line you personally sent.

## Slack text normalization (bug fix)

New helper `cleanSlackText(raw: string): string`, applied to every piece of
raw Slack message text as soon as it's captured (in `searchSlackMessages`,
`searchSlackMentions`, and the new context-fetching functions):

- `<url|label>` → `url` (drop the label, keep the bare URL — the existing
  `applyLinkification`/`extractGitHubUrls` pipeline already handles bare
  GitHub URLs correctly; it's only the `<url|label>` wrapper form that it
  mishandles).
- `<url>` → `url` (drop the angle brackets for consistency; harmless since
  `applyLinkification` already separately supported this form, but
  normalizing early means one code path instead of two).

Scoped narrowly to URL-wrapping syntax only — other Slack mrkdwn (e.g.
`<@U123>` user mentions, `<#C123|name>` channel mentions) is left as-is;
out of scope for this change.

## Thread detection algorithm

Slack's `search.messages` results inconsistently populate `thread_ts` on
matches (confirmed by manual testing: some genuine thread replies have no
`thread_ts` field at all in search results). So instead of trusting that
field, each matched message gets authoritatively checked:

1. Call `conversations.replies(channel=channelId, ts=<message's own ts>)`.
2. If the response already contains **more than one message**, the matched
   message's own `ts` was itself the thread root — this response *is*
   already the full thread; no second call needed. Proceed straight to
   capping/rendering (below).
3. If the response contains exactly one message, check that message's
   `thread_ts` field (always accurately populated on this direct lookup,
   unlike search results):
   - If it equals the message's own `ts` (or is absent), it's a standalone
     message — proceed to the before/after context fetch.
   - If it differs, the message is a reply; issue a second call,
     `conversations.replies(channel=channelId, ts=<that thread_ts>)`, to
     fetch the entire thread from its actual root.

### Full-thread fetch

`conversations.replies(channel=channelId, ts=<root thread_ts>)` returns the
whole thread (root + all replies) in chronological order. Capped to 20
total messages: keep the root plus the most recent 19 replies. If replies
were truncated, insert a marker line noting how many earlier replies were
omitted.

### Standalone context fetch

Two `conversations.history` calls, combined chronologically with the
message itself in the middle:

- "before": `latest=<ts>, inclusive=false, limit=3`
- "after": `oldest=<ts>, inclusive=false, limit=3`

(Verified via live testing that this returns the expected messages
immediately before/after a given timestamp in a channel.)

## Deduplication

A per-run cache tracks which message `ts` values have already been resolved
to a thread. Once a thread is fully fetched, every reply's `ts` inside it
is marked resolved, so if another one of your matched messages that day
happens to be in the same thread, it's recognized immediately — no repeat
detection call, no repeat full-thread fetch.

## Name resolution

Each participant's Slack user ID (root/replies/history messages) is
resolved to a display name via `users.info`, cached per-run in a
`Map<string, string>` (`real_name || name || <raw user ID>` as fallback).
This is a separate, simpler cache than the existing `isBotUser` cache
(no bot-filtering needed here — context messages from bots are shown like
any other participant, since they may explain what you were responding to,
e.g. an incident bot post).

## Rate limiting & capping

All enrichment calls (detection + thread-fetch + history-fetch) are made
**sequentially**, not in parallel, to avoid bursting Slack's rate limits.
A running counter tracks total enrichment API calls made across the whole
run; once it reaches **150**, all remaining unresolved messages fall back
to today's plain behavior (matched message only, no context) — this keeps
worst-case runtime and API usage bounded on very active days. Name
resolution (`users.info`) calls are not counted against this cap — they're
inherently deduplicated per unique user (typically a small, bounded set of
participants per day) and are comparatively cheap.

Any error at any step (detection, thread fetch, history fetch, name
resolution) degrades gracefully to the plain fallback for that specific
message/thread only — never fails the whole Slack summary.

## Rendering & prompt changes

`renderSlackFacts` is reworked to render each thread's full (or
context-windowed) transcript, with each line prefixed by its resolved
author name — using literally `You:` for lines you sent — instead of only
ever showing your own lines:

```
#licensing-and-access-team:
  Thread 1 (link: https://...):
  - Alex Chen: is the twirp-read-request-latency-dotcom monitor actionable?
  - You: it has been really flappy
  - Priya Shah: depends on the root cause, could be a cosmos issue...
```

Threads/messages that fell back to the plain behavior (enrichment
unavailable or capped out) render exactly as today — just your own line(s),
no author prefix.

`buildSummaryPrompt`'s instructions are updated to explain the new format:
lines from other participants are provided only as context; the model
should reason about and summarize only what `You` said or did, using the
other lines to understand what you were responding to or discussing.

## Testing / verification approach

No automated tests exist in this repo for `dailyActivity.ts` (consistent
with the rest of the codebase). Verification will be manual: run
`npm run build`/`npm run lint`, then exercise the code path against the
real Slack workspace (as was done for the Mentions feature) to confirm
thread transcripts and standalone context render correctly, links get
linkified, and the cap/fallback logic behaves as expected when forced
(e.g. by temporarily lowering the cap constant during testing).
