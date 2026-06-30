# Daily Activity Log — Design

**Date:** 2026-06-30
**Status:** Approved (design)

## Summary

Automatically generate an end-of-day "Daily Activity" section appended to each
day's work log (`logs/YYYY-MM-DD.md`). The section contains:

1. An **AI narrative** paragraph blending GitHub and Slack activity.
2. A **factual GitHub list** (issues created, PRs created, commits authored, and
   Copilot agent PRs) with links — rendered deterministically, never
   hallucinated.
3. An **AI Slack summary**, broken down per public channel, of the messages and
   thread replies the user sent that day.

Generation runs automatically each evening (configurable hour, default 18:00 PT)
and on demand via a "Generate daily activity" button in the work-log panel.

## Goals

- Capture a factual, link-rich record of the day's GitHub activity across the
  user's `GITHUB_ORG` repositories.
- Summarize the user's public-channel Slack activity, grouped by channel, using
  the Copilot CLI's configured Slack MCP tools.
- Persist the result into the existing daily work log so it is searchable,
  exportable, and auto-committed like the rest of the log.
- Be safe to run repeatedly (idempotent) and degrade gracefully on partial
  failure.

## Non-Goals

- No new panel or storage format — output lives inside the existing work log.
- No private-channel or DM Slack summarization (public channels only).
- No historical backfill UI beyond generating for a chosen date.

## Output Format — Managed Block

The generated content is written into a delimited, idempotent block appended to
`logs/YYYY-MM-DD.md`. Re-running **replaces** everything between the markers, so
the scheduled run and the manual button are safe to run repeatedly.

```markdown
<!-- daily-activity:start -->
## 📊 Daily Activity — 2026-06-30

_Summary_
<AI narrative blending GitHub + Slack>

### GitHub
- Opened PR [owner/repo#123](url): title
- Created issue [owner/repo#45](url): title
- 3 commits in `owner/repo` ([abc123](url), …)
- Copilot agent: PR [owner/repo#130](url): title

### Slack
**#channel-name** — <summary of my messages/replies in that channel>
**#another-channel** — <summary>
<!-- daily-activity:end -->
```

Behaviors:

- **Idempotent:** the block is identified by the `daily-activity:start/end`
  HTML comment markers. A pure helper replaces an existing block or appends a new
  one. No duplication on re-run.
- **Predictable empties:** sections with no data render a short placeholder
  (`_No public Slack activity._`, `_No GitHub activity._`) rather than being
  omitted, so structure is stable.
- Plain markdown, so it renders in the Tiptap editor and is picked up by search
  and export.

## Data Gathering

New module `src/lib/dailyActivity.ts`.

### GitHub (deterministic, via existing Octokit helper)

Day boundaries use `America/Los_Angeles` (matching `getTodayDate()`). The org
list comes from `GITHUB_ORG` (comma-separated, already supported). For each org:

- **Issues created:** `search/issues` q=`author:@me type:issue created:YYYY-MM-DD org:<org>`
- **PRs created:** `search/issues` q=`author:@me type:pr created:YYYY-MM-DD org:<org>`
- **Commits authored:** `search/commits` q=`author:@me org:<org> author-date:YYYY-MM-DD`
- **Copilot agent PRs:** reuse the `gh agent-task list` logic from the sessions
  route, filtered to PRs created/updated that day.

Returns a typed `GitHubActivity` object with arrays of issues / PRs / commits /
agent PRs, each carrying `{ title, url, number, repo }` (commits carry
`{ repo, sha, url, message }`).

### Slack (agentic, via Copilot SDK + GitHub's Slack MCP)

Slack access uses GitHub's official **Slack MCP** server
([github/copilot-slack-mcp](https://github.com/github/copilot-slack-mcp)) — a
read-only HTTP MCP at `https://mcp.slack.com/mcp`. It is installed as a Copilot
CLI plugin:

```bash
copilot plugin marketplace add github/copilot-slack-mcp \
  && copilot plugin install slack-mcp@github-slack-mcp
```

The plugin configures the MCP server and handles OAuth (a one-time browser auth
on the first Slack query). Because our app drives the Copilot CLI in server mode
via the SDK, an SDK session inherits the CLI's configured MCP servers — so once
the plugin is installed and authenticated, the Slack tools are available to our
session. (The SDK's HTTP MCP config has no OAuth field, so configuring the server
manually is not viable; relying on the CLI plugin is the supported path.)

A Copilot SDK session is created and the prompt instructs Copilot to:

1. Find messages and thread replies the user sent **today (PT)** in **public
   channels**, grouped by channel.
2. Write one short summary per channel.
3. Write an overall narrative paragraph that blends those Slack activities with
   the supplied structured GitHub facts.

An `onPermissionRequest` handler auto-approves the read-only Slack tool calls.
The structured GitHub data is passed into the prompt for the narrative, but the
**factual GitHub list in the block is rendered by us**, not the model, so PR
numbers and links are always correct.

**Risk to validate during implementation:** confirm the SDK session actually
inherits the plugin's Slack tools. If it does not, fall back to writing the
GitHub list with `### Slack\n_Slack summary unavailable._` rather than failing
the whole run. The same graceful fallback covers the not-installed and
not-authenticated cases.

## API, Scheduler & UI Trigger

### API route — `src/app/api/daily-activity/route.ts`

- `POST { date }`:
  1. Validate `date` with `isValidDate`.
  2. Gather GitHub activity (deterministic).
  3. Call Copilot for the Slack per-channel summary + blended narrative.
  4. Assemble the section and write the managed block into `logs/<date>.md`.
  5. Commit via `commitWorkLog`.
  6. Return the section markdown.
- `export const maxDuration = 300` (the MCP call can be slow, matching the
  summary route).
- An in-flight guard prevents the scheduled run and a manual click from writing
  simultaneously.

### Scheduler — `src/lib/scheduler.ts`

The scheduler already ticks hourly. Add a daily evening trigger: when local PT
time passes the configured hour (default **18:00**) and today's block has not yet
been generated, fire generation once for today. A last-generated-date flag
prevents duplicate runs. The hour is configurable via an optional
`dailyActivityHour` field in `data/config.json` (with an env override).

### UI trigger — `src/components/RawWorkLog.tsx`

A "Generate daily activity" button. On click:

1. `POST /api/daily-activity` for `currentDate`.
2. **Insert/replace the managed block in the editor's in-memory content and save
   through the normal path.** This avoids the editor's autosave clobbering the
   server-written block.
3. Show a spinner and last-generated state.

The editor-open conflict is handled by routing the manual path through the
editor; the scheduled path writes server-side (intended for end-of-day when the
user is not actively editing), and the idempotent block makes any overlap
self-healing on next load.

## Error Handling & Edge Cases

- **Partial failure:** GitHub and Slack gathering are independent. If Slack/MCP
  fails, still write the GitHub list with a "_Slack summary unavailable._" note.
  If GitHub gathering fails, surface the error in the API response and skip
  writing (do not clobber the log with an empty block).
- **No activity:** sections render predictable "_No …_" lines; the block is still
  written so re-runs stay idempotent.
- **Demo mode:** disabled (matches other AI features) — button hidden / API
  returns a canned response, no Copilot/MCP calls.
- **Path safety:** `isValidDate` on the date param before any file path is built.
- **Concurrency:** in-flight guard shared between scheduled and manual paths.
- **Token/scope:** reuses existing `GITHUB_READ_TOKEN` → `GH_TOKEN` →
  `gh auth token` priority; `search/commits` needs no extra scope for org repos
  the token can read.

## Testing & Docs

- No automated test suite exists. Verify with `npm run build` (type-check) and
  manual runs against a real date.
- Add a small pure helper for building/replacing the managed block (easy to
  reason about and the most logic-heavy piece).
- Update `README.md` (new feature + any config/env) and `CHANGELOG.md`
  (user-facing entry).

## Components Summary

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `src/lib/dailyActivity.ts` | Gather GitHub activity; orchestrate Copilot Slack call; assemble section markdown | `github.ts`, `copilot.ts`, `gh agent-task list` |
| managed-block helper (in `dailyActivity.ts` or `files.ts`) | Pure insert/replace of the delimited block in log content | none |
| `src/app/api/daily-activity/route.ts` | HTTP entry: validate, gather, write, commit | `dailyActivity.ts`, `files.ts`, `git.ts` |
| `src/lib/scheduler.ts` (extended) | Fire daily generation at configured evening hour | `dailyActivity.ts` / API |
| `src/components/RawWorkLog.tsx` (extended) | Button + editor-synced apply of the block | `/api/daily-activity` |
