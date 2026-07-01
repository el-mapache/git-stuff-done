/**
 * Slack access mechanism — the contract this module implements against.
 *
 * Slack data comes from the `gh-slack` CLI extension (already used elsewhere
 * in this app for Slack thread previews, see src/app/api/slack/route.ts),
 * NOT the Copilot SDK / github/copilot-slack-mcp plugin. An earlier attempt
 * to search Slack by driving a Copilot SDK session with that MCP plugin
 * connected but reliably failed to actually find any messages (the model
 * had no dependable way to invoke a working search), so that approach was
 * replaced with a deterministic search step:
 *
 *   gh slack api get search.messages -t <team> -f query="from:me on:<date>" -f count=100
 *
 * This calls Slack's real `search.messages` Web API (via the user's own
 * Slack session, same auth `gh-slack` already uses) and reliably returns
 * every message the authenticated user sent that day, with channel name,
 * privacy flag, and timestamp. Results are filtered to `is_private === false`
 * channels and to messages whose timestamp actually falls on the requested
 * date in America/Los_Angeles (defense in depth beyond Slack's own `on:`
 * search operator). Only the found messages are then handed to a plain
 * (non-tool-calling) Copilot SDK prompt to write the per-channel summary and
 * blended narrative — the AI's job is summarization only, not searching.
 *
 * Requires the `SLACK_TEAM` env var (falls back to the first comma-separated
 * `GITHUB_ORG` value) and the `gh-slack` extension installed + authenticated
 * (`gh extension install https://github.com/rneatherway/gh-slack`, then
 * `eval $(gh-slack auth -t <team>)` once per the extension's own docs).
 * Degrades gracefully to "_Slack summary unavailable._" if the team isn't
 * configured, the extension isn't installed, or the search fails for any
 * reason — the GitHub-derived section is never blocked by a Slack failure.
 */
import { CopilotClient } from "@github/copilot-sdk";
import { execFile } from "child_process";
import { promisify } from "util";
import { fetchGitHubActivity, type GitHubActivity } from "./github";
import { fetchAgentTasks } from "./agentTasks";
import { upsertBlock } from "./managedBlock";
import { readLog, writeLog, isValidDate } from "./files";
import { commitWorkLog } from "./git";
import { DAILY_ACTIVITY_KEY } from "./constants";

export { DAILY_ACTIVITY_KEY };

type AgentPR = { number: number; title: string; url: string; repoFullName: string };

/** Format a UTC ISO-8601 timestamp as YYYY-MM-DD in America/Los_Angeles. */
function isoToLocalDate(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** Agent-session PRs whose PR was created or updated on `date`. */
async function fetchAgentActivity(date: string): Promise<AgentPR[]> {
  try {
    const raw = await fetchAgentTasks(30);
    return raw
      .filter((t) => t.pullRequestNumber !== null && t.repository)
      .filter((t) => (t.createdAt && isoToLocalDate(t.createdAt) === date) || (t.updatedAt && isoToLocalDate(t.updatedAt) === date))
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
  const reviewStateLabel: Record<string, string> = {
    approved: "Approved",
    changes_requested: "Requested changes on",
    commented: "Reviewed (comment on)",
  };

  for (const pr of gh.prsOpened) {
    lines.push(`- Opened PR [${pr.repoFullName}#${pr.number}](${pr.url}): ${pr.title}`);
  }
  for (const pr of gh.prsMerged) {
    lines.push(`- Merged PR [${pr.repoFullName}#${pr.number}](${pr.url}): ${pr.title}`);
  }
  for (const pr of gh.prsClosedUnmerged) {
    lines.push(`- Closed PR [${pr.repoFullName}#${pr.number}](${pr.url}): ${pr.title}`);
  }
  for (const issue of gh.issuesOpened) {
    lines.push(`- Created issue [${issue.repoFullName}#${issue.number}](${issue.url}): ${issue.title}`);
  }
  for (const issue of gh.issuesClosed) {
    lines.push(`- Closed issue [${issue.repoFullName}#${issue.number}](${issue.url}): ${issue.title}`);
  }
  for (const review of gh.reviews) {
    const label = reviewStateLabel[review.state] ?? "Reviewed";
    const snippet = review.body ? `: ${review.body}` : "";
    lines.push(`- ${label} PR [${review.repoFullName}#${review.number}](${review.url}) (${review.title})${snippet}`);
  }

  // Group comments by repo, listing each comment as a sub-bullet — mirrors the commit grouping below.
  const commentsByRepo = new Map<string, typeof gh.comments>();
  for (const c of gh.comments) {
    const arr = commentsByRepo.get(c.repoFullName) ?? [];
    arr.push(c);
    commentsByRepo.set(c.repoFullName, arr);
  }
  for (const [repo, cs] of commentsByRepo) {
    lines.push(`- ${cs.length} comment${cs.length === 1 ? "" : "s"} in \`${repo}\`:`);
    for (const c of cs) {
      const snippet = c.body ? `: ${c.body}` : "";
      lines.push(`  - [${c.targetType === "pr" ? "PR" : "issue"} #${c.number}](${c.url})${snippet}`);
    }
  }

  // Group commits by repo, listing each commit's message.
  const byRepo = new Map<string, typeof gh.commits>();
  for (const c of gh.commits) {
    const arr = byRepo.get(c.repoFullName) ?? [];
    arr.push(c);
    byRepo.set(c.repoFullName, arr);
  }
  for (const [repo, cs] of byRepo) {
    lines.push(`- ${cs.length} commit${cs.length === 1 ? "" : "s"} in \`${repo}\`:`);
    for (const c of cs) {
      lines.push(`  - [${c.shortSha}](${c.url}) ${c.message}`);
    }
  }
  const seenPRs = new Set(gh.prsOpened.map((p) => `${p.repoFullName}#${p.number}`));
  for (const pr of agent) {
    if (seenPRs.has(`${pr.repoFullName}#${pr.number}`)) continue;
    lines.push(`- Copilot agent: PR [${pr.repoFullName}#${pr.number}](${pr.url}): ${pr.title}`);
  }
  const body = lines.length > 0 ? lines.join("\n") : "_No GitHub activity._";
  const warning = gh.truncated
    ? "\n\n_⚠️ GitHub activity search hit an API history limit before confirming the full day was covered — some activity may be missing._"
    : "";
  return body + warning;
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
    ``,
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
const execFileAsync = promisify(execFile);

/** Reject after `ms` so unbounded SDK calls can't hang the orchestrator. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms).unref?.(),
    ),
  ]);
}

/** Resolve the Slack team for `gh slack`: explicit SLACK_TEAM, else the first GITHUB_ORG entry. */
function slackTeam(): string {
  const explicit = process.env.SLACK_TEAM?.trim();
  if (explicit) return explicit;
  return (process.env.GITHUB_ORG ?? "").split(",")[0]?.trim() ?? "";
}

type SlackMessage = { channel: string; text: string; ts: string; permalink?: string };

/** Format a Slack epoch `ts` (e.g. "1782855930.731429") as YYYY-MM-DD in America/Los_Angeles. */
function tsToLocalDate(ts: string): string {
  const millis = Math.floor(parseFloat(ts) * 1000);
  return new Date(millis).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/**
 * Search Slack for messages the authenticated user sent on `date`, via the
 * `gh-slack` extension's raw API passthrough. Filters to public channels and
 * to messages genuinely timestamped on `date` (defense in depth beyond
 * Slack's own `on:` search operator). Returns `null` (not an empty array) if
 * the search itself couldn't be attempted or failed, so callers can
 * distinguish "no team configured / extension missing / search error" from
 * "searched successfully and found nothing".
 */
async function searchSlackMessages(date: string): Promise<SlackMessage[] | null> {
  const team = slackTeam();
  if (!team) {
    console.log("[dailyActivity] Slack: no SLACK_TEAM/GITHUB_ORG configured, skipping");
    return null;
  }
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["slack", "api", "get", "search.messages", "-t", team, "-f", `query=from:me on:${date}`, "-f", "count=100"],
      { env: { ...process.env, NO_COLOR: "1" }, maxBuffer: 20 * 1024 * 1024 },
    );
    const data = JSON.parse(stdout) as {
      ok?: boolean;
      error?: string;
      messages?: { matches?: Array<{ channel?: { name?: string; is_private?: boolean }; text?: string; ts?: string; permalink?: string }> };
    };
    if (!data.ok) {
      console.error(`[dailyActivity] Slack search.messages returned ok:false${data.error ? ` (${data.error})` : ""}`);
      return null;
    }
    const matches = data.messages?.matches ?? [];
    const messages: SlackMessage[] = [];
    for (const m of matches) {
      if (!m.channel || m.channel.is_private || !m.channel.name || !m.ts) continue;
      if (tsToLocalDate(m.ts) !== date) continue;
      messages.push({ channel: m.channel.name, text: m.text ?? "", ts: m.ts, permalink: m.permalink });
    }
    return messages;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const notInstalled =
      msg.includes("executable file not found") ||
      msg.includes("unknown command") ||
      msg.includes("no extension") ||
      msg.includes("command not found");
    if (notInstalled) {
      console.log("[dailyActivity] Slack: gh-slack extension not installed, skipping");
    } else {
      console.error("[dailyActivity] Slack search failed:", msg);
    }
    return null;
  }
}

/** Render the raw Slack messages, grouped by channel, as facts for the summarizer prompt. */
function renderSlackFacts(messages: SlackMessage[]): string {
  if (messages.length === 0) return "(no public Slack messages found)";
  const byChannel = new Map<string, SlackMessage[]>();
  for (const m of messages) {
    const arr = byChannel.get(m.channel) ?? [];
    arr.push(m);
    byChannel.set(m.channel, arr);
  }
  const lines: string[] = [];
  for (const [channel, msgs] of byChannel) {
    lines.push(`#${channel}:`);
    for (const m of msgs.slice(0, 20)) {
      const text = m.text.replace(/\s+/g, " ").trim().slice(0, 300);
      lines.push(`- ${text || "(no text, e.g. a file/attachment)"}`);
    }
  }
  return lines.join("\n");
}

/** Build the prompt that asks the model to summarize already-gathered Slack facts. */
function buildSummaryPrompt(date: string, gh: GitHubActivity, agent: AgentPR[], slackFacts: string): string {
  const ghFacts = renderGitHubList(gh, agent);
  return `You are generating the end-of-day activity summary for ${date} (timezone America/Los_Angeles).

Below are the public-channel Slack messages I actually sent on ${date} (already collected — do not search for more, just summarize what's given).

Produce a response in exactly this format, with no preamble:

NARRATIVE:
<one short paragraph (2-4 sentences) blending my GitHub work below with my Slack activity into a cohesive summary of my day>

SLACK:
<for each channel below that has messages, one line: "**#channel-name** — short summary of what I discussed/decided there". If there are no Slack messages below, output exactly "_No public Slack activity._">

My GitHub activity for the day (reference it in the narrative, do not re-list it under SLACK):
${ghFacts}

My Slack messages for the day, grouped by channel:
${slackFacts}`;
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
 * Post-process the model's per-channel Slack section: insert a blank line
 * between channel entries (the model reliably keeps them on consecutive
 * lines despite prompt instructions) and append a link to that channel's
 * first message, so each entry is scannable and clickable back to context.
 */
function formatSlackSection(slackSection: string, messages: SlackMessage[]): string {
  if (!slackSection || slackSection.startsWith("_")) return slackSection; // fallback / "no activity" text
  const firstPermalinkByChannel = new Map<string, string>();
  for (const m of messages) {
    if (m.permalink && !firstPermalinkByChannel.has(m.channel)) {
      firstPermalinkByChannel.set(m.channel, m.permalink);
    }
  }
  const lines = slackSection
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const rendered = lines.map((line) => {
    const match = line.match(/^\*\*#([^*]+)\*\*/);
    if (!match) return line;
    const link = firstPermalinkByChannel.get(match[1]);
    return link ? `${line} ([view](${link}))` : line;
  });
  return rendered.join("\n\n");
}

/**
 * Search Slack (via gh-slack) for the day's public messages, then call
 * Copilot with a plain (non-tool-calling) prompt to produce the narrative +
 * per-channel Slack summary. Returns a graceful fallback on any failure.
 */
async function fetchSlackSummary(date: string, gh: GitHubActivity, agent: AgentPR[]): Promise<SlackResult> {
  const messages = await searchSlackMessages(date);
  if (messages === null) {
    return { narrative: "", slackSection: "_Slack summary unavailable._" };
  }

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
      { prompt: buildSummaryPrompt(date, gh, agent, renderSlackFacts(messages)) },
      120_000,
    );
    const content = res?.data?.content ?? "";
    const parsed = parseSlackResponse(content);
    return { narrative: parsed.narrative, slackSection: formatSlackSection(parsed.slackSection, messages) };
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

