/**
 * Slack access mechanism (spike findings — Task 6) — the contract Task 7 implements against.
 *
 * Slack data comes from GitHub's official Slack MCP: github/copilot-slack-mcp.
 * It is a READ-ONLY HTTP MCP server at https://mcp.slack.com/mcp, installed as a
 * Copilot CLI plugin (`copilot plugin install slack-mcp@github-slack-mcp`). Its
 * `.mcp.json` authenticates via OAuth (`oauthClientId` + `oauthPublicClient`),
 * completed via a one-time interactive browser flow the first time a Slack tool runs.
 *
 * Read-only tool names exposed by the plugin:
 *   slack_search_public, slack_read_channel, slack_read_thread,
 *   slack_read_user_profile, slack_read_canvas
 * (slack_search_public matches our "public channels only" scope.)
 *
 * SDK-inheritance probe result: a default `CopilotClient.createSession()` did NOT
 * expose the slack_* tools ("NO SLACK TOOLS"). Two compounding reasons:
 *   1. The one-time OAuth had not been completed in the probe environment, so the
 *      MCP server never connected.
 *   2. The SDK's `MCPRemoteServerConfig` ({ type, url, headers?, tools }) has no
 *      OAuth field, so a manual `mcpServers` override cannot supply credentials.
 * Therefore Task 7 relies on the CLI plugin context: it drives the Slack summary
 * through an SDK session and degrades gracefully to "_Slack summary unavailable._"
 * whenever the slack_* tools are absent or the calls fail. Full Slack output
 * requires the operator to complete the one-time `copilot` Slack OAuth in the
 * runtime environment where this app runs.
 *
 * Permission handler contract (from @github/copilot-sdk types.d.ts):
 *   PermissionRequestResult.kind is "approved" | "denied-by-rules" | ...
 *   so onPermissionRequest should return `{ kind: "approved" }` for the read-only
 *   Slack calls — no `as never` cast needed.
 */
import { CopilotClient } from "@github/copilot-sdk";
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
  const seenPRs = new Set(gh.prsCreated.map((p) => `${p.repoFullName}#${p.number}`));
  for (const pr of agent) {
    if (seenPRs.has(`${pr.repoFullName}#${pr.number}`)) continue;
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

const SLACK_MODEL = process.env.DAILY_ACTIVITY_MODEL || "gpt-4.1";

/** Reject after `ms` so unbounded SDK calls can't hang the orchestrator. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms).unref?.(),
    ),
  ]);
}

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
    const session = await withTimeout(
      client.createSession({
        model: SLACK_MODEL,
        onPermissionRequest: async () => ({ kind: "approved" as const }),
      }),
      30_000,
      "createSession",
    );
    const res = await session.sendAndWait({ prompt: buildSlackPrompt(date, gh, agent) }, 240_000);
    const content = res?.data?.content ?? "";
    return parseSlackResponse(content);
  } catch (e) {
    console.error("[dailyActivity] fetchSlackSummary failed:", e);
    return { narrative: "", slackSection: "_Slack summary unavailable._" };
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

/**
 * Gather everything for `date`, write the managed block into the log, commit.
 * Returns the section markdown (between markers). Throws only if GitHub
 * gathering fails outright (so we never clobber the log with an empty block).
 */
async function generateDailyActivityImpl(date: string): Promise<string> {
  const gh = await fetchGitHubActivity(date); // throws on hard failure
  const agent = await fetchAgentActivity(date);

  const slack = await fetchSlackSummary(date, gh, agent);
  const parts: DailyActivityParts = {
    gh,
    agent,
    slackSection: slack.slackSection,
    narrative: slack.narrative,
  };

  const section = assembleSection(date, parts);
  const existing = await readLog(date);
  const updated = upsertBlock(existing, DAILY_ACTIVITY_KEY, section);
  await writeLog(date, updated);
  commitWorkLog(`docs(activity): daily activity ${date}`);
  return section;
}

// Shared in-flight guard, keyed by date, so the evening scheduler and a manual
// API/button trigger can never run generation for the SAME date concurrently
// (which would race on readLog/writeLog/commitWorkLog and clobber each
// other's write). Different dates don't conflict (they touch different log
// files) and are allowed to run independently and concurrently, so this is a
// Map keyed by date rather than a single scalar slot.
const inFlightByDate = new Map<string, Promise<string>>();

export async function generateDailyActivity(date: string): Promise<string> {
  if (!isValidDate(date)) throw new Error("Invalid date");
  const existing = inFlightByDate.get(date);
  if (existing) return existing;

  const promise = generateDailyActivityImpl(date).finally(() => {
    // Only clear this date's own entry — never touch other dates' entries.
    inFlightByDate.delete(date);
  });
  inFlightByDate.set(date, promise);
  return promise;
}

