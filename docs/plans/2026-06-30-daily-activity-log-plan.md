# Daily Activity Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate an idempotent end-of-day "Daily Activity" section — factual GitHub list + AI Slack-per-channel summary + blended narrative — appended to each day's work log, on a configurable evening schedule and via a manual button.

**Architecture:** A pure managed-block helper edits a delimited region of the log markdown. A `dailyActivity` orchestrator gathers GitHub activity deterministically (Octokit search + `gh agent-task list`) and calls the Copilot SDK with the Slack MCP enabled for the Slack summary + narrative. An API route writes the block and commits; the scheduler fires it each evening; a button in the work-log panel triggers it through the editor to avoid autosave clobbering.

**Tech Stack:** Next.js 16 (App Router), TypeScript, `@octokit/rest`, `@github/copilot-sdk`, `gh` CLI, Tailwind v4.

**Testing note:** This repo has **no automated test framework** (Playwright is installed but unconfigured; do not add a runner). The verification gate for code tasks is `npm run build` (full type-check) plus targeted manual checks (`curl`, browser). The one pure-logic module (`managedBlock.ts`) is verified with a throwaway `npx tsx` script that is deleted afterward.

**Risk flagged in spec:** It is not yet confirmed that the Copilot SDK session inherits the Slack MCP tools from the installed CLI plugin. Slack access uses GitHub's official **Slack MCP** ([github/copilot-slack-mcp](https://github.com/github/copilot-slack-mcp)) — a read-only HTTP MCP installed as a Copilot CLI plugin that handles OAuth on first use. **Task 6 is a verification spike** that confirms the SDK session can reach the plugin's Slack tools before the Slack call is wired in Task 7. All Slack-dependent code degrades gracefully (writes `_Slack summary unavailable._`) so the feature works GitHub-only if the MCP path fails or the plugin isn't installed/authenticated.

**Prerequisite for the Slack half:** the operator installs and authenticates the plugin once:

```bash
copilot plugin marketplace add github/copilot-slack-mcp \
  && copilot plugin install slack-mcp@github-slack-mcp
# then run any Slack query in `copilot` once to complete browser OAuth
```

---

## File Structure

| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `src/lib/managedBlock.ts` | Create | Pure insert/replace of a delimited `<!-- key:start/end -->` block in markdown |
| `src/lib/agentTasks.ts` | Create | Shared `fetchAgentTasks()` extracted from the sessions route |
| `src/app/api/sessions/route.ts` | Modify | Use shared `fetchAgentTasks()` (remove duplicate) |
| `src/lib/github.ts` | Modify | Add `fetchGitHubActivity(date)` (issues/PRs created, commits authored) |
| `src/lib/dailyActivity.ts` | Create | Orchestrate: gather GitHub + agent PRs, call Copilot for Slack/narrative, assemble section markdown, write block, commit |
| `src/lib/files.ts` | Modify | Add `dailyActivityHour` to `AppConfig` + default |
| `src/app/api/daily-activity/route.ts` | Create | HTTP entry: validate date, run orchestrator, return section markdown |
| `src/lib/scheduler.ts` | Modify | Fire generation once each evening at the configured hour |
| `src/components/RawWorkLog.tsx` | Modify | "Generate daily activity" button; apply block via editor + save |
| `README.md` | Modify | Document the feature + config/env |
| `CHANGELOG.md` | Modify | User-facing entry |

---

## Task 1: Managed-block pure helper

**Files:**
- Create: `src/lib/managedBlock.ts`
- Verify (throwaway): `scripts/__verify-managed-block.ts`

- [ ] **Step 1: Write the helper**

Create `src/lib/managedBlock.ts`:

```typescript
// Pure helpers for inserting/replacing a delimited block in markdown.
// A block is identified by HTML comment markers so it survives round-trips
// through the markdown editor and is safe to replace idempotently.

export function startMarker(key: string): string {
  return `<!-- ${key}:start -->`;
}

export function endMarker(key: string): string {
  return `<!-- ${key}:end -->`;
}

/**
 * Replace the existing `key` block in `source` with `block`, or append it
 * (separated by a blank line) if no block exists yet. `block` is the full
 * content that goes BETWEEN the markers (markers are added here).
 * Idempotent: running twice with the same inputs yields the same output.
 */
export function upsertBlock(source: string, key: string, block: string): string {
  const start = startMarker(key);
  const end = endMarker(key);
  const wrapped = `${start}\n${block.trim()}\n${end}`;

  const startIdx = source.indexOf(start);
  const endIdx = source.indexOf(end);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = source.slice(0, startIdx);
    const after = source.slice(endIdx + end.length);
    return `${before}${wrapped}${after}`;
  }

  const base = source.trimEnd();
  return base.length > 0 ? `${base}\n\n${wrapped}\n` : `${wrapped}\n`;
}
```

- [ ] **Step 2: Write throwaway verification script**

Create `scripts/__verify-managed-block.ts`:

```typescript
import assert from "node:assert";
import { upsertBlock } from "../src/lib/managedBlock";

// Append to empty
const a = upsertBlock("", "daily-activity", "hello");
assert.ok(a.includes("<!-- daily-activity:start -->"));
assert.ok(a.includes("hello"));
assert.ok(a.includes("<!-- daily-activity:end -->"));

// Append to existing content
const b = upsertBlock("# Log\n\nNotes", "daily-activity", "hello");
assert.ok(b.startsWith("# Log\n\nNotes"));
assert.ok(b.includes("hello"));

// Idempotent replace (run twice -> identical)
const once = upsertBlock(b, "daily-activity", "world");
const twice = upsertBlock(once, "daily-activity", "world");
assert.strictEqual(once, twice);
assert.ok(once.includes("world"));
assert.ok(!once.includes("hello"));

console.log("managedBlock OK");
```

- [ ] **Step 3: Run the verification**

Run: `npx tsx scripts/__verify-managed-block.ts`
Expected: prints `managedBlock OK` and exits 0.

- [ ] **Step 4: Delete the throwaway script**

Run: `rm scripts/__verify-managed-block.ts`

- [ ] **Step 5: Type-check**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/managedBlock.ts docs/plans/2026-06-30-daily-activity-log-design.md docs/plans/2026-06-30-daily-activity-log-plan.md
git commit -m "feat: add managed-block markdown helper and daily-activity design/plan

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: Extract shared agent-task fetcher

**Files:**
- Create: `src/lib/agentTasks.ts`
- Modify: `src/app/api/sessions/route.ts`

- [ ] **Step 1: Create the shared module**

Create `src/lib/agentTasks.ts` (move the type + fetch/retry logic out of the route):

```typescript
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export type AgentSession = {
  id: string;
  name: string;
  repository: string | null;
  state: string;
  pullRequestNumber: number | null;
  pullRequestState: "OPEN" | "MERGED" | "CLOSED" | null;
  pullRequestUrl: string | null;
  taskUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

const GH_FIELDS = [
  "id",
  "name",
  "repository",
  "state",
  "pullRequestNumber",
  "pullRequestState",
  "pullRequestUrl",
  "createdAt",
  "updatedAt",
].join(",");

export type RawTask = Omit<AgentSession, "taskUrl">;

/** Fetch raw agent tasks, halving the window if gh chokes on a bad record. */
export async function fetchAgentTasks(limit: number): Promise<RawTask[]> {
  if (limit < 5) throw new Error("Minimum limit reached with no successful response");
  try {
    const { stdout } = await execAsync(
      `gh agent-task list --json ${GH_FIELDS} --limit ${limit}`,
      { env: { ...process.env, NO_COLOR: "1" } }
    );
    return JSON.parse(stdout) as RawTask[];
  } catch (err) {
    const isGhError = err instanceof Error && err.message.includes("Could not resolve");
    if (isGhError) {
      console.warn(`[agentTasks] gh failed at limit=${limit}, retrying with limit=${Math.floor(limit / 2)}`);
      return fetchAgentTasks(Math.floor(limit / 2));
    }
    throw err;
  }
}
```

- [ ] **Step 2: Update the sessions route to use it**

In `src/app/api/sessions/route.ts`, remove the local `AgentSession` type, `GH_FIELDS`, `RawTask`, and `fetchTasks`, and import from the shared module. The file becomes:

```typescript
import { NextResponse } from 'next/server';
import { fetchAgentTasks, type AgentSession } from '@/lib/agentTasks';

export type { AgentSession };

export async function GET() {
  try {
    const raw = await fetchAgentTasks(30);
    const sessions: AgentSession[] = raw
      .filter((s) => s.pullRequestNumber !== null && s.pullRequestState !== 'MERGED')
      .map((s) => {
        const prUrl = s.pullRequestUrl ?? (s.repository && s.pullRequestNumber
          ? `https://github.com/${s.repository}/pull/${s.pullRequestNumber}`
          : null);
        return {
          ...s,
          pullRequestUrl: prUrl,
          taskUrl: prUrl ? `${prUrl}/agent-sessions/${s.id}` : null,
        };
      });
    console.log(`[sessions] Returning ${sessions.length} agent tasks`);
    return NextResponse.json(sessions);
  } catch (err) {
    const isNotFound =
      err instanceof Error &&
      (err.message.includes('executable file not found') ||
        err.message.includes('command not found'));
    console.error('[sessions] Failed to fetch agent tasks:', err);
    return NextResponse.json([], { status: isNotFound ? 503 : 500 });
  }
}
```

- [ ] **Step 3: Confirm `AgentSession` is still importable for demo data**

Run: `grep -rn "AgentSession" src/lib/demo.ts src/components/AgentSessions.tsx`
Expected: imports resolve (demo.ts imports `AgentSession` from the sessions route, which now re-exports it). If demo.ts imports from `@/app/api/sessions/route`, leave it — the `export type { AgentSession }` line preserves it.

- [ ] **Step 4: Type-check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agentTasks.ts src/app/api/sessions/route.ts
git commit -m "refactor: extract shared fetchAgentTasks helper

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: GitHub activity fetcher

**Files:**
- Modify: `src/lib/github.ts` (append new exported function + types near the other fetchers, e.g. after `fetchMyIssues`)

- [ ] **Step 1: Add types and the fetcher**

Append to `src/lib/github.ts`:

```typescript
// --- Daily activity (created issues/PRs + authored commits) ---

export type ActivityItem = {
  number: number;
  title: string;
  url: string;
  repoFullName: string;
};

export type CommitItem = {
  sha: string;
  shortSha: string;
  message: string;
  url: string;
  repoFullName: string;
};

export type GitHubActivity = {
  issuesCreated: ActivityItem[];
  prsCreated: ActivityItem[];
  commits: CommitItem[];
};

/** Split a comma-separated GITHUB_ORG into trimmed, non-empty org names. */
function orgList(): string[] {
  return GITHUB_ORG.split(",").map((o) => o.trim()).filter(Boolean);
}

/**
 * Gather issues created, PRs created, and commits authored by the
 * authenticated user on `date` (YYYY-MM-DD) across all configured orgs.
 * Ignored repos are filtered out. Failures in any single query are logged
 * and treated as empty so a partial outage still yields a useful result.
 */
export async function fetchGitHubActivity(date: string): Promise<GitHubActivity> {
  const octokit = await getOctokit();
  const config = await readConfig();
  const { data: userData } = await octokit.users.getAuthenticated();
  const user = userData.login;
  const orgs = orgList();

  const repoOf = (item: { repository_url?: string; html_url?: string }) => {
    if (item.repository_url) {
      const parts = item.repository_url.split("/");
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }
    return "";
  };
  const ignored = (repoFullName: string) =>
    config.ignoredRepos.includes(repoFullName.split("/").pop() ?? "");

  const issuesCreated: ActivityItem[] = [];
  const prsCreated: ActivityItem[] = [];
  const commits: CommitItem[] = [];

  for (const org of orgs) {
    // Issues created
    try {
      const res = await octokit.search.issuesAndPullRequests({
        q: `is:issue author:${user} org:${org} created:${date}`,
        per_page: 50,
      });
      for (const item of res.data.items) {
        const repoFullName = repoOf(item);
        if (ignored(repoFullName)) continue;
        issuesCreated.push({ number: item.number, title: item.title, url: item.html_url, repoFullName });
      }
    } catch (e) {
      console.error(`[github] fetchGitHubActivity issues ${org}:`, e);
    }

    // PRs created
    try {
      const res = await octokit.search.issuesAndPullRequests({
        q: `is:pr author:${user} org:${org} created:${date}`,
        per_page: 50,
      });
      for (const item of res.data.items) {
        const repoFullName = repoOf(item);
        if (ignored(repoFullName)) continue;
        prsCreated.push({ number: item.number, title: item.title, url: item.html_url, repoFullName });
      }
    } catch (e) {
      console.error(`[github] fetchGitHubActivity prs ${org}:`, e);
    }

    // Commits authored
    try {
      const res = await octokit.search.commits({
        q: `author:${user} org:${org} author-date:${date}`,
        per_page: 50,
      });
      for (const item of res.data.items) {
        const repoFullName = item.repository?.full_name ?? "";
        if (ignored(repoFullName)) continue;
        const sha = item.sha;
        commits.push({
          sha,
          shortSha: sha.slice(0, 7),
          message: item.commit.message.split("\n")[0],
          url: item.html_url,
          repoFullName,
        });
      }
    } catch (e) {
      console.error(`[github] fetchGitHubActivity commits ${org}:`, e);
    }
  }

  console.log(
    `[github] fetchGitHubActivity ${date}: ${issuesCreated.length} issues, ${prsCreated.length} PRs, ${commits.length} commits`,
  );
  return { issuesCreated, prsCreated, commits };
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: build succeeds. (If `octokit.search.commits` reports a typing issue on `item.repository`, it is optional — the `?? ""` guard already handles it.)

- [ ] **Step 3: Manual smoke test**

Start the dev server if not running (`npm run dev`), then in a Node REPL or a temporary route is unnecessary — instead verify indirectly in Task 8 via the API. For now confirm types only.

- [ ] **Step 4: Commit**

```bash
git add src/lib/github.ts
git commit -m "feat: add fetchGitHubActivity for daily issues/PRs/commits

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: Config field for the evening hour

**Files:**
- Modify: `src/lib/files.ts`

- [ ] **Step 1: Extend `AppConfig` and the default**

In `src/lib/files.ts`, update the type and default:

```typescript
export type AppConfig = {
  ignoredRepos: string[];
  fontSize: string;
  dailyActivityHour: number;
};
```

```typescript
const defaultConfig: AppConfig = { ignoredRepos: [], fontSize: '1', dailyActivityHour: 18 };
```

(The existing `readConfig` already spreads `defaultConfig`, so older config files without the field get the default automatically.)

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/files.ts
git commit -m "feat: add dailyActivityHour config field

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: Daily-activity orchestrator (GitHub-only first)

This task assembles the section using GitHub data + agent PRs, with a **placeholder Slack section** (`_Slack summary unavailable._`). The Slack/narrative AI call is wired in Task 7 after the spike.

**Files:**
- Create: `src/lib/dailyActivity.ts`

- [ ] **Step 1: Create the orchestrator**

Create `src/lib/dailyActivity.ts`:

```typescript
import { fetchGitHubActivity, type GitHubActivity } from "./github";
import { fetchAgentTasks } from "./agentTasks";
import { upsertBlock } from "./managedBlock";
import { readLog, writeLog, isValidDate } from "./files";
import { commitWorkLog } from "./git";

export const DAILY_ACTIVITY_KEY = "daily-activity";

type AgentPR = { number: number; title: string; url: string; repoFullName: string };

/** Agent-session PRs whose PR was created or updated on `date`. */
async function fetchAgentActivity(date: string): Promise<AgentPR[]> {
  try {
    const raw = await fetchAgentTasks(30);
    return raw
      .filter((t) => t.pullRequestNumber !== null && t.repository)
      .filter((t) => (t.createdAt?.slice(0, 10) === date) || (t.updatedAt?.slice(0, 10) === date))
      .map((t) => ({
        number: t.pullRequestNumber as number,
        title: t.name,
        url: t.pullRequestUrl ?? `https://github.com/${t.repository}/pull/${t.pullRequestNumber}`,
        repoFullName: t.repository as string,
      }));
  } catch (e) {
    console.error("[dailyActivity] fetchAgentActivity failed:", e);
    return [];
  }
}

/** Render the factual GitHub list as markdown bullets. */
function renderGitHubList(gh: GitHubActivity, agent: AgentPR[]): string {
  const lines: string[] = [];
  for (const pr of gh.prsCreated) {
    lines.push(`- Opened PR [${pr.repoFullName}#${pr.number}](${pr.url}): ${pr.title}`);
  }
  for (const issue of gh.issuesCreated) {
    lines.push(`- Created issue [${issue.repoFullName}#${issue.number}](${issue.url}): ${issue.title}`);
  }
  // Group commits by repo
  const byRepo = new Map<string, typeof gh.commits>();
  for (const c of gh.commits) {
    const arr = byRepo.get(c.repoFullName) ?? [];
    arr.push(c);
    byRepo.set(c.repoFullName, arr);
  }
  for (const [repo, cs] of byRepo) {
    const links = cs.map((c) => `[${c.shortSha}](${c.url})`).join(", ");
    lines.push(`- ${cs.length} commit${cs.length === 1 ? "" : "s"} in \`${repo}\` (${links})`);
  }
  for (const pr of agent) {
    lines.push(`- Copilot agent: PR [${pr.repoFullName}#${pr.number}](${pr.url}): ${pr.title}`);
  }
  return lines.length > 0 ? lines.join("\n") : "_No GitHub activity._";
}

export type DailyActivityParts = {
  gh: GitHubActivity;
  agent: AgentPR[];
  slackSection: string; // markdown for the body of the ### Slack section
  narrative: string;    // markdown paragraph (may be empty)
};

/** Assemble the full Daily Activity block body (between the markers). */
export function assembleSection(date: string, parts: DailyActivityParts): string {
  const githubList = renderGitHubList(parts.gh, parts.agent);
  const narrative = parts.narrative.trim() || "_Summary unavailable._";
  const slack = parts.slackSection.trim() || "_No public Slack activity._";
  return [
    `## 📊 Daily Activity — ${date}`,
    ``,
    `_Summary_`,
    narrative,
    ``,
    `### GitHub`,
    githubList,
    ``,
    `### Slack`,
    slack,
  ].join("\n");
}

/**
 * Gather everything for `date`, write the managed block into the log, commit.
 * Returns the section markdown (between markers). Throws only if GitHub
 * gathering fails outright (so we never clobber the log with an empty block).
 */
export async function generateDailyActivity(date: string): Promise<string> {
  if (!isValidDate(date)) throw new Error("Invalid date");

  const gh = await fetchGitHubActivity(date); // throws on hard failure
  const agent = await fetchAgentActivity(date);

  // Slack + narrative are wired in Task 7. Placeholder for now.
  const parts: DailyActivityParts = {
    gh,
    agent,
    slackSection: "_Slack summary unavailable._",
    narrative: "",
  };

  const section = assembleSection(date, parts);
  const existing = await readLog(date);
  const updated = upsertBlock(existing, DAILY_ACTIVITY_KEY, section);
  await writeLog(date, updated);
  commitWorkLog(`docs(activity): daily activity ${date}`);
  return section;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/dailyActivity.ts
git commit -m "feat: add daily-activity orchestrator (GitHub-only)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 6: SPIKE — confirm the GitHub Slack MCP plugin is reachable from the SDK

This is an investigation task. Its output is a short findings comment block at the top of `src/lib/dailyActivity.ts` documenting the confirmed mechanism, plus the chosen approach for Task 7. Do **not** leave the spike code in the build.

Slack access uses GitHub's official Slack MCP: [github/copilot-slack-mcp](https://github.com/github/copilot-slack-mcp) (read-only HTTP MCP at `https://mcp.slack.com/mcp`, installed as a Copilot CLI plugin, OAuth on first use).

**Files:**
- Create (throwaway): `scripts/__spike-slack-mcp.ts`

- [ ] **Step 1: Ensure the plugin is installed and authenticated**

Run:
```bash
copilot plugin marketplace add github/copilot-slack-mcp \
  && copilot plugin install slack-mcp@github-slack-mcp
copilot plugin list 2>&1 | grep -i slack
```
Then run any Slack query inside `copilot` once (e.g. "Catch me up on the last 5 messages in #general") to complete the one-time browser OAuth. Confirm it returns Slack content. Note the exact tool names the CLI reports for the Slack server (e.g. `search_messages`, `conversations_history`, profile/canvas tools).

- [ ] **Step 2: Probe whether the SDK session inherits the plugin's Slack tools**

Create `scripts/__spike-slack-mcp.ts`:

```typescript
import { CopilotClient } from "@github/copilot-sdk";

async function main() {
  const client = new CopilotClient();
  try {
    const session = await client.createSession({
      model: "gpt-4.1",
      onPermissionRequest: async () => ({ kind: "allow" } as never),
    });
    const res = await session.sendAndWait(
      { prompt: "List every tool you have available, one per line, including any Slack tools. If you have no Slack tools, say 'NO SLACK TOOLS'." },
      120_000,
    );
    console.log("=== RESPONSE ===");
    console.log(res?.data?.content ?? "(empty)");
  } finally {
    await client.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run: `npx tsx scripts/__spike-slack-mcp.ts`

- [ ] **Step 3: Decide the wiring approach based on output**

- If the Slack tools from the plugin appear automatically → Task 7 only needs `onPermissionRequest` (auto-allow the read-only Slack calls) and a good prompt. No `mcpServers` override required. **This is the expected outcome.**
- If the Slack tools do NOT appear → the SDK session is not inheriting CLI plugins. Since the Slack MCP is HTTP+OAuth and the SDK's `MCPRemoteServerConfig` has no OAuth field, a manual `mcpServers` override is not viable. In that case, document that the Slack half requires running generation through the CLI plugin context and keep the graceful fallback as the effective behavior; record this clearly.
- Note the precise `onPermissionRequest` return shape the SDK accepts (inspect `node_modules/@github/copilot-sdk/dist/types.d.ts` for `PermissionHandler` / the permission result type) and record it so Task 7 can drop the `as never` cast.

- [ ] **Step 4: Record findings**

Add a comment block at the top of `src/lib/dailyActivity.ts` summarizing: that Slack uses github/copilot-slack-mcp (plugin), whether the SDK session inherits the plugin tools, the relevant tool names, and the exact `onPermissionRequest` shape. This is the contract Task 7 implements against.

- [ ] **Step 5: Clean up**

Run: `rm scripts/__spike-slack-mcp.ts`

- [ ] **Step 6: Commit findings**

```bash
git add src/lib/dailyActivity.ts
git commit -m "docs: record GitHub Slack MCP access mechanism for daily activity

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 7: Wire the Slack + narrative AI call

Implements the Slack-per-channel summary and the blended narrative using the mechanism confirmed in Task 6.

**Files:**
- Modify: `src/lib/dailyActivity.ts`

- [ ] **Step 1: Add the Copilot call**

Add to `src/lib/dailyActivity.ts` (imports at top, function before `generateDailyActivity`):

```typescript
import { CopilotClient } from "@github/copilot-sdk";
```

```typescript
const SLACK_MODEL = process.env.DAILY_ACTIVITY_MODEL || "gpt-4.1";

/** Build the prompt that drives Slack gathering + narrative writing. */
function buildSlackPrompt(date: string, gh: GitHubActivity, agent: AgentPR[]): string {
  const ghFacts = renderGitHubList(gh, agent);
  return `You are generating the end-of-day activity summary for ${date} (timezone America/Los_Angeles).

Use the Slack tools available to you to find messages and thread replies that *I* (the authenticated Slack user) sent in PUBLIC channels on ${date}. Ignore private channels and DMs.

Produce a response in exactly this format, with no preamble:

NARRATIVE:
<one short paragraph (2-4 sentences) blending my GitHub work below with my Slack activity into a cohesive summary of my day>

SLACK:
<for each public channel I posted in, one line: "**#channel-name** — short summary of what I discussed/decided there". If I had no public Slack activity, output exactly "_No public Slack activity._">

My GitHub activity for the day (already collected — reference it in the narrative, do not re-list it under SLACK):
${ghFacts}`;
}

type SlackResult = { narrative: string; slackSection: string };

/** Parse the model's NARRATIVE:/SLACK: response into parts. */
export function parseSlackResponse(text: string): SlackResult {
  const slackIdx = text.indexOf("SLACK:");
  const narrIdx = text.indexOf("NARRATIVE:");
  if (narrIdx === -1 || slackIdx === -1 || slackIdx < narrIdx) {
    return { narrative: "", slackSection: "_Slack summary unavailable._" };
  }
  const narrative = text.slice(narrIdx + "NARRATIVE:".length, slackIdx).trim();
  const slackSection = text.slice(slackIdx + "SLACK:".length).trim();
  return {
    narrative,
    slackSection: slackSection || "_No public Slack activity._",
  };
}

/**
 * Call Copilot with the Slack MCP to produce the narrative + per-channel Slack
 * summary. Returns a graceful fallback on any failure.
 */
async function fetchSlackSummary(date: string, gh: GitHubActivity, agent: AgentPR[]): Promise<SlackResult> {
  const client = new CopilotClient();
  try {
    // NOTE: createSession config below reflects the mechanism confirmed in the
    // Task 6 spike for github/copilot-slack-mcp (installed as a Copilot CLI
    // plugin). Expected path: the SDK session inherits the plugin's Slack tools,
    // so only onPermissionRequest (auto-allow read-only Slack calls) is needed.
    const session = await client.createSession({
      model: SLACK_MODEL,
      onPermissionRequest: async () => ({ kind: "allow" } as never),
    });
    const res = await session.sendAndWait({ prompt: buildSlackPrompt(date, gh, agent) }, 240_000);
    const content = res?.data?.content ?? "";
    return parseSlackResponse(content);
  } catch (e) {
    console.error("[dailyActivity] fetchSlackSummary failed:", e);
    return { narrative: "", slackSection: "_Slack summary unavailable._" };
  } finally {
    await client.stop();
  }
}
```

- [ ] **Step 2: Use it in `generateDailyActivity`**

Replace the placeholder block in `generateDailyActivity` so it calls `fetchSlackSummary`:

```typescript
  const gh = await fetchGitHubActivity(date); // throws on hard failure
  const agent = await fetchAgentActivity(date);

  const slack = await fetchSlackSummary(date, gh, agent);
  const parts: DailyActivityParts = {
    gh,
    agent,
    slackSection: slack.slackSection,
    narrative: slack.narrative,
  };
```

- [ ] **Step 3: Adjust `onPermissionRequest`/`mcpServers` per spike findings**

If Task 6 found the permission result shape differs from `{ kind: "allow" }`, fix it now (remove the `as never` cast and use the real type from `PermissionHandler`). If explicit `mcpServers` is required, add it to `createSession`.

- [ ] **Step 4: Type-check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dailyActivity.ts
git commit -m "feat: add Slack per-channel summary and narrative via Copilot MCP

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 8: API route

**Files:**
- Create: `src/app/api/daily-activity/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/daily-activity/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { isValidDate, getTodayDate } from "@/lib/files";
import { generateDailyActivity } from "@/lib/dailyActivity";

export const maxDuration = 300;

// Shared in-flight guard so the scheduler and a manual click can't write at once.
let inFlight: Promise<string> | null = null;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const date = (body as { date?: string }).date || getTodayDate();
    if (!isValidDate(date)) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }
    if (!inFlight) {
      inFlight = generateDailyActivity(date).finally(() => { inFlight = null; });
    } else {
      console.log("[daily-activity] Coalescing with in-flight generation");
    }
    const section = await inFlight;
    return NextResponse.json({ success: true, date, section });
  } catch (err) {
    console.error("[daily-activity] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate daily activity" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual end-to-end test**

Start dev server: `npm run dev` (ensure `GITHUB_ORG`, `GITHUB_READ_TOKEN` set in `.env.local`).
Run (use today or a recent date with known activity):
```bash
curl -s -X POST http://localhost:3000/api/daily-activity \
  -H 'Content-Type: application/json' \
  -d '{"date":"REPLACE-WITH-DATE"}' | head -c 2000
```
Expected: JSON with `success: true` and a `section` containing `## 📊 Daily Activity`, a `### GitHub` list, and a `### Slack` section. Then confirm the block was written:
```bash
grep -n "daily-activity:start" logs/REPLACE-WITH-DATE.md
```
Expected: the markers exist exactly once. Run the curl again and re-grep — still exactly one block (idempotent).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/daily-activity/route.ts
git commit -m "feat: add daily-activity API route

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 9: Evening scheduler trigger

**Files:**
- Modify: `src/lib/scheduler.ts`

- [ ] **Step 1: Add the evening trigger**

Rewrite `src/lib/scheduler.ts` to add a daily generation check while keeping the hourly commit:

```typescript
import { commitWorkLog, isNewDay } from "./git";
import { getTodayDate, readConfig } from "./files";
import { generateDailyActivity } from "./dailyActivity";

let intervalId: ReturnType<typeof setInterval> | null = null;
let lastDate: string = getTodayDate();
let lastGeneratedDate: string | null = null;
let generating = false;

/** Current hour (0-23) in the app's fixed timezone. */
function currentHourPT(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const hour = parts.find((p) => p.type === "hour")?.value ?? "0";
  // Intl can emit "24" at midnight; normalize to 0.
  return parseInt(hour, 10) % 24;
}

async function maybeGenerateDaily(): Promise<void> {
  if (generating) return;
  const today = getTodayDate();
  if (lastGeneratedDate === today) return;
  let hour = 18;
  try {
    hour = (await readConfig()).dailyActivityHour;
  } catch { /* use default */ }
  if (currentHourPT() < hour) return;

  generating = true;
  try {
    console.log(`Scheduler: generating daily activity for ${today}`);
    await generateDailyActivity(today);
    lastGeneratedDate = today;
    console.log(`Scheduler: daily activity generated for ${today}`);
  } catch (err) {
    console.error("Scheduler: daily activity generation failed", err);
    // Leave lastGeneratedDate unset so the next tick retries.
  } finally {
    generating = false;
  }
}

function tick(): void {
  if (isNewDay(lastDate)) {
    console.log("Scheduler: new day detected, committing yesterday's work");
    lastDate = getTodayDate();
  }

  try {
    const result = commitWorkLog();
    if (result.committed) {
      console.log(`Scheduler: committed work log — ${result.message}`);
    } else {
      console.log(`Scheduler: nothing to commit`);
    }
  } catch (err) {
    console.error("Scheduler: commit failed", err);
  }

  void maybeGenerateDaily();
}

export function startScheduler(): void {
  if (intervalId) return; // guard against double-start
  console.log("Scheduler: started (hourly auto-commit + evening daily activity)");
  intervalId = setInterval(tick, 60 * 60 * 1000);
}

export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("Scheduler: stopped");
  }
}
```

Note: the hourly interval means generation fires within the hour after `dailyActivityHour`. This matches the "evening" requirement without adding a sub-hour timer.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual trigger verification (optional, fast)**

Temporarily set `dailyActivityHour` low to force a run: in `data/config.json` set `"dailyActivityHour": 0`, restart `npm run dev`, watch logs for `Scheduler: generating daily activity`. The first tick fires after the interval; to verify immediately you may instead rely on the Task 8 API test. Restore `dailyActivityHour` to `18` afterward.

- [ ] **Step 4: Commit**

```bash
git add src/lib/scheduler.ts
git commit -m "feat: generate daily activity on an evening schedule

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 10: Work-log panel button

**Files:**
- Modify: `src/components/RawWorkLog.tsx`

- [ ] **Step 1: Add imports and state**

In `src/components/RawWorkLog.tsx`, add `Sparkles` to the lucide import and `upsertBlock` + key import:

```typescript
import { AlertTriangle, FileText, Link2, Sparkles } from 'lucide-react';
import { upsertBlock } from '@/lib/managedBlock';
```

Add `DAILY_ACTIVITY_KEY` as a local constant (avoid importing the server orchestrator into a client bundle):

```typescript
const DAILY_ACTIVITY_KEY = 'daily-activity';
```

Add state near the other `useState` hooks:

```typescript
  const [generating, setGenerating] = useState(false);
```

- [ ] **Step 2: Add the handler**

Add near `handleLinkify`:

```typescript
  const handleGenerateActivity = async () => {
    if (isDemo) return;
    setGenerating(true);
    try {
      // Persist current edits first so we merge into the latest content.
      await save(latestContentRef.current);
      const res = await fetch('/api/daily-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: currentDate }),
      });
      const data = await res.json();
      if (data.success && data.section) {
        const merged = upsertBlock(latestContentRef.current, DAILY_ACTIVITY_KEY, data.section);
        setContent(merged);
        latestContentRef.current = merged;
        setHasContent(!!merged.trim());
        await save(merged);
      } else {
        handleUploadError(data.error || 'Failed to generate daily activity');
      }
    } catch {
      handleUploadError('Failed to generate daily activity');
    } finally {
      setGenerating(false);
    }
  };
```

- [ ] **Step 3: Add the button**

In the header `div` (next to the Linkify button), add before it:

```tsx
          <button
            onClick={handleGenerateActivity}
            disabled={generating || isDemo}
            title={isDemo ? 'Disabled in demo mode' : 'Generate today\u2019s GitHub + Slack activity summary'}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground transition hover:opacity-80 disabled:opacity-40"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {generating ? 'Generating…' : 'Daily activity'}
          </button>
```

Note: the `TiptapEditor` `content` prop is the source of truth on remount; setting `content` + `latestContentRef` + saving keeps the editor, the ref, and the file in sync, so the editor's next autosave won't clobber the block.

- [ ] **Step 4: Type-check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual UI test**

`npm run dev`, open http://localhost:3000, click **Daily activity** in the work-log panel header. Expected: spinner → a `📊 Daily Activity` section appears at the end of the editor, the save indicator shows `Saved ✓`, and clicking again replaces (not duplicates) the section.

- [ ] **Step 6: Commit**

```bash
git add src/components/RawWorkLog.tsx
git commit -m "feat: add Daily activity button to work-log panel

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 11: Documentation

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: README — add a feature bullet**

In the `## Features` list of `README.md`, add:

```markdown
- **📊 Daily Activity** — Auto-generated end-of-day log appended to your work log: a factual list of the GitHub issues/PRs you created and commits you authored (including Copilot agent PRs), plus an AI summary of your public-channel Slack activity grouped by channel and a blended narrative. Runs automatically each evening and on demand via the **Daily activity** button.
```

- [ ] **Step 2: README — document config/env**

Add a row to the Environment Variables table:

```markdown
| `DAILY_ACTIVITY_MODEL`    | `gpt-4.1`                         | Model used to summarize Slack activity for the daily log                |
```

And under setup/notes, mention that the evening hour is configurable via `dailyActivityHour` in `data/config.json` (default `18`, local PT), and that the Slack summary requires GitHub's Slack MCP plugin installed and authenticated in the Copilot CLI:

```bash
copilot plugin marketplace add github/copilot-slack-mcp \
  && copilot plugin install slack-mcp@github-slack-mcp
# then run any Slack query in `copilot` once to complete browser OAuth
```

Note that the Slack half is read-only and degrades gracefully — if the plugin is not installed or authenticated, the daily section still renders the GitHub list with a "_Slack summary unavailable._" note. Also add a Prerequisites bullet for the [github/copilot-slack-mcp](https://github.com/github/copilot-slack-mcp) plugin (optional, enables the Slack summary).

- [ ] **Step 3: CHANGELOG — user-facing entry**

Add under today's date in `CHANGELOG.md`:

```markdown
## 2026-06-30

### Added

- **Daily Activity summary** — Your work log now gets an automatic end-of-day section listing the GitHub issues and pull requests you created and the commits you authored (including Copilot agent work), alongside an AI summary of your public Slack channel activity grouped by channel. It’s generated automatically each evening and can be triggered any time with the new **Daily activity** button.
```

(If a `## 2026-06-30` heading already exists, add the bullet under its `### Added`.)

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document daily activity feature

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 12: Final verification

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no new errors in changed files.

- [ ] **Step 3: End-to-end sanity**

`npm run dev`; click **Daily activity**; confirm section renders, links resolve, re-run is idempotent, and the change is committed to the data git repo (check `git -C <data dir> log --oneline -1`).

- [ ] **Step 4: Confirm graceful Slack fallback**

Temporarily break Slack access (e.g. rename/disable the Slack MCP or run on a day with no Slack activity) and confirm the section still renders the GitHub list with `_Slack summary unavailable._` or `_No public Slack activity._` rather than erroring.

---

## Self-Review Notes

- **Spec coverage:** managed block (T1), GitHub list incl. commits+agent (T3,T5), Slack per-channel + narrative (T6,T7), append-to-log idempotent (T1,T5), evening schedule + manual button (T9,T10), editor-clobber handling (T10), partial-failure/empty/demo/path-safety (T5,T7,T8,T12), docs (T11). All covered.
- **Placeholder scan:** no TBDs; every code step includes full code. Task 6 is an explicit, bounded spike, not a placeholder.
- **Type consistency:** `GitHubActivity`/`ActivityItem`/`CommitItem` (T3) used unchanged in T5/T7; `fetchAgentTasks` (T2) used in T5; `upsertBlock(source,key,block)` signature consistent across T1/T5/T10; `DAILY_ACTIVITY_KEY` value `'daily-activity'` identical in server (T5) and client (T10); `generateDailyActivity(date)` used in T8/T9.
