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
 *
 * The Mentions section uses the same `search.messages` mechanism but with
 * `query=<@USER_ID> on:<date>` (USER_ID resolved once via `auth.test`), and
 * deliberately does NOT filter by channel privacy or the `slackChannels`
 * allowlist — mentions are checked across every channel/DM the token can
 * see (public, private, group DM, 1:1 DM), since a mention anywhere is
 * actionable regardless of channel. Messages authored by me are excluded
 * (a mention search can occasionally surface my own messages, e.g. if I
 * quoted my own handle), and messages authored by bot accounts are excluded
 * via a `users.info` lookup of the `is_bot` flag (cached per run) — bots
 * like changelog/notifier accounts mention people constantly and would
 * otherwise drown out real mentions from humans.
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
import { fetchGitHubActivity, extractGitHubUrls, fetchLinkInfo, type GitHubActivity, type GitHubLinkInfo } from "./github";
import { cleanSlackText, createEnrichmentContext, getMessageContext } from "./slackThreadContext";
import { fetchAgentTasks } from "./agentTasks";
import { upsertBlock, extractBlock } from "./managedBlock";
import { readLog, writeLog, isValidDate, writeSummary, readConfig } from "./files";
import { commitWorkLog } from "./git";
import { applyLinkification } from "./copilot";
import { DAILY_ACTIVITY_KEY } from "./constants";

export { DAILY_ACTIVITY_KEY };

type AgentPR = { number: number; title: string; url: string; repoFullName: string };

/**
 * Linkify bare GitHub PR/issue URLs the model may have preserved from the
 * original Slack message text, using the same `repo#number: title` linked
 * markdown convention as the rest of the app (src/lib/copilot.ts, used for
 * the work log's own linkify action).
 */
async function linkifyGitHubMentions(markdown: string): Promise<string> {
  const urls = await extractGitHubUrls(markdown);
  if (urls.length === 0) return markdown;
  const linkMap = new Map<string, GitHubLinkInfo>();
  const results = await Promise.all(urls.map((u) => fetchLinkInfo(u)));
  for (const info of results) {
    if (info) linkMap.set(info.url, info);
  }
  return applyLinkification(markdown, linkMap);
}

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
    lines.push(`- Opened PR [${pr.title} (${pr.repoFullName}#${pr.number})](${pr.url})`);
  }
  for (const pr of gh.prsMerged) {
    lines.push(`- Merged PR [${pr.title} (${pr.repoFullName}#${pr.number})](${pr.url})`);
  }
  for (const pr of gh.prsClosedUnmerged) {
    lines.push(`- Closed PR [${pr.title} (${pr.repoFullName}#${pr.number})](${pr.url})`);
  }
  for (const issue of gh.issuesOpened) {
    lines.push(`- Created issue [${issue.title} (${issue.repoFullName}#${issue.number})](${issue.url})`);
  }
  for (const issue of gh.issuesClosed) {
    lines.push(`- Closed issue [${issue.title} (${issue.repoFullName}#${issue.number})](${issue.url})`);
  }
  for (const review of gh.reviews) {
    const label = reviewStateLabel[review.state] ?? "Reviewed";
    const snippet = review.body ? `: ${review.body}` : "";
    lines.push(`- ${label} PR [${review.title} (${review.repoFullName}#${review.number})](${review.url})${snippet}`);
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
      lines.push(`  - [${c.title} (${c.repoFullName}#${c.number})](${c.url})${snippet}`);
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
    lines.push(`- Copilot agent: PR [${pr.title} (${pr.repoFullName}#${pr.number})](${pr.url})`);
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
  mentionsSection: string; // markdown for the body of the ### Mentions section
};

/** Assemble the full Daily Activity block body (between the markers). */
export function assembleSection(date: string, parts: DailyActivityParts): string {
  const githubList = renderGitHubList(parts.gh, parts.agent);
  const slack = parts.slackSection.trim() || "_No public Slack activity._";
  const mentions = parts.mentionsSection.trim() || "_No mentions found._";
  return [
    `## 📊 Daily Activity — ${date}`,
    ``,
    `### GitHub`,
    githubList,
    ``,
    `### Slack`,
    slack,
    ``,
    `### Mentions`,
    mentions,
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

/** Resolve my own Slack user ID (needed to search for `<@id>` mentions), via `auth.test`. Returns `null` on any failure. */
async function getSlackUserId(team: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["slack", "api", "get", "auth.test", "-t", team],
      { env: { ...process.env, NO_COLOR: "1" }, maxBuffer: 1024 * 1024 },
    );
    const data = JSON.parse(stdout) as { ok?: boolean; user_id?: string };
    if (!data.ok || !data.user_id) return null;
    return data.user_id;
  } catch (e) {
    console.error("[dailyActivity] getSlackUserId failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Whether a Slack user is a bot account, via `users.info`. Used to filter
 * bot-authored mentions (changelog/notifier bots mention people constantly
 * and would otherwise drown out real human mentions). Fails open (treats
 * lookup errors as "not a bot") so a transient API hiccup can't silently
 * drop a real mention.
 */
async function isBotUser(userId: string, team: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["slack", "api", "get", "users.info", "-t", team, "-f", `user=${userId}`],
      { env: { ...process.env, NO_COLOR: "1" }, maxBuffer: 1024 * 1024 },
    );
    const data = JSON.parse(stdout) as { ok?: boolean; user?: { is_bot?: boolean } };
    if (!data.ok) return false;
    return data.user?.is_bot === true;
  } catch (e) {
    console.error("[dailyActivity] isBotUser failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

type SlackMessage = { channel: string; channelId?: string; text: string; ts: string; permalink?: string; threadTs?: string; author?: string };

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
      messages?: { matches?: Array<{ channel?: { id?: string; name?: string; is_private?: boolean }; text?: string; ts?: string; permalink?: string; thread_ts?: string }> };
    };
    if (!data.ok) {
      console.error(`[dailyActivity] Slack search.messages returned ok:false${data.error ? ` (${data.error})` : ""}`);
      return null;
    }
    // If the user configured an allowlist of channels to check, restrict to
    // those (empty list means "check all public channels", the prior default).
    let allowedChannels: Set<string> | null = null;
    try {
      const configured = (await readConfig()).slackChannels;
      if (configured.length > 0) {
        allowedChannels = new Set(configured.map((c) => c.toLowerCase()));
      }
    } catch {
      /* treat as no allowlist configured */
    }
    const matches = data.messages?.matches ?? [];
    const messages: SlackMessage[] = [];
    for (const m of matches) {
      if (!m.channel || m.channel.is_private || !m.channel.name || !m.ts) continue;
      if (tsToLocalDate(m.ts) !== date) continue;
      if (allowedChannels && !allowedChannels.has(m.channel.name.toLowerCase())) continue;
      messages.push({
        channel: m.channel.name,
        channelId: m.channel.id,
        text: cleanSlackText(m.text ?? ""),
        ts: m.ts,
        permalink: m.permalink,
        threadTs: m.thread_ts,
      });
    }
    return messages;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isGhSlackNotInstalledError(msg)) {
      console.log("[dailyActivity] Slack: gh-slack extension not installed, skipping");
    } else {
      console.error("[dailyActivity] Slack search failed:", msg);
    }
    return null;
  }
}

/** Whether an error message indicates the `gh-slack` extension isn't installed (vs. some other failure). */
function isGhSlackNotInstalledError(msg: string): boolean {
  return (
    msg.includes("executable file not found") ||
    msg.includes("unknown command") ||
    msg.includes("no extension") ||
    msg.includes("command not found")
  );
}

/**
 * Search Slack for messages that `@mention` me on `date`, via the same
 * `gh-slack` raw API passthrough. Unlike `searchSlackMessages`, this checks
 * every channel/DM the token can see (no public-only filter, no
 * `slackChannels` allowlist — a mention anywhere is actionable) and excludes
 * messages I authored myself and messages from bot accounts (checked via
 * `isBotUser`, cached per call since a day's mentions rarely span more than
 * a handful of distinct authors). Returns `null` if the search itself
 * couldn't be attempted (same "unavailable" vs. "found nothing" contract as
 * `searchSlackMessages`).
 */
async function searchSlackMentions(date: string, team: string, myUserId: string): Promise<SlackMessage[] | null> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["slack", "api", "get", "search.messages", "-t", team, "-f", `query=<@${myUserId}> on:${date}`, "-f", "count=100"],
      { env: { ...process.env, NO_COLOR: "1" }, maxBuffer: 20 * 1024 * 1024 },
    );
    const data = JSON.parse(stdout) as {
      ok?: boolean;
      error?: string;
      messages?: {
        matches?: Array<{
          channel?: { name?: string; is_im?: boolean };
          user?: string;
          username?: string;
          text?: string;
          ts?: string;
          permalink?: string;
          thread_ts?: string;
        }>;
      };
    };
    if (!data.ok) {
      console.error(`[dailyActivity] Slack mentions search.messages returned ok:false${data.error ? ` (${data.error})` : ""}`);
      return null;
    }
    const matches = data.messages?.matches ?? [];
    const botCache = new Map<string, boolean>();
    const messages: SlackMessage[] = [];
    for (const m of matches) {
      if (!m.channel || !m.ts || !m.user) continue;
      if (tsToLocalDate(m.ts) !== date) continue;
      if (m.user === myUserId) continue; // exclude messages I authored myself

      let isBot = botCache.get(m.user);
      if (isBot === undefined) {
        isBot = await isBotUser(m.user, team);
        botCache.set(m.user, isBot);
      }
      if (isBot) continue;

      // DM channels have no usable `name` (it's the other user's ID) — label with the sender's own username instead.
      const channelLabel = m.channel.is_im ? `DM with ${m.username ?? "unknown"}` : (m.channel.name ?? "unknown");
      messages.push({
        channel: channelLabel,
        text: cleanSlackText(m.text ?? ""),
        ts: m.ts,
        permalink: m.permalink,
        threadTs: m.thread_ts,
        author: m.username,
      });
    }
    return messages;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isGhSlackNotInstalledError(msg)) {
      console.log("[dailyActivity] Mentions: gh-slack extension not installed, skipping");
    } else {
      console.error("[dailyActivity] Mentions search failed:", msg);
    }
    return null;
  }
}

/** The thread a message belongs to: its own `ts` if it's a thread root or standalone, else its parent's `thread_ts`. */
function threadKey(m: SlackMessage): string {
  return m.threadTs && m.threadTs !== m.ts ? m.threadTs : m.ts;
}

/** Render the raw Slack messages, grouped by channel then by thread, as facts for the summarizer prompt. */
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
    const byThread = new Map<string, SlackMessage[]>();
    for (const m of msgs) {
      const arr = byThread.get(threadKey(m)) ?? [];
      arr.push(m);
      byThread.set(threadKey(m), arr);
    }
    let threadNum = 1;
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

/**
 * Render the raw @mention messages, grouped by channel/DM then by thread, as
 * facts for the mentions-summarizer prompt. Unlike `renderSlackFacts`, each
 * line also names who sent it, since (unlike the "messages I sent" summary)
 * the author varies per message.
 */
function renderMentionFacts(messages: SlackMessage[]): string {
  if (messages.length === 0) return "(no mentions found)";
  const byChannel = new Map<string, SlackMessage[]>();
  for (const m of messages) {
    const arr = byChannel.get(m.channel) ?? [];
    arr.push(m);
    byChannel.set(m.channel, arr);
  }
  const lines: string[] = [];
  for (const [channel, msgs] of byChannel) {
    lines.push(`${channel.startsWith("DM with") ? channel : `#${channel}`}:`);
    const byThread = new Map<string, SlackMessage[]>();
    for (const m of msgs) {
      const arr = byThread.get(threadKey(m)) ?? [];
      arr.push(m);
      byThread.set(threadKey(m), arr);
    }
    let threadNum = 1;
    for (const [, threadMsgs] of byThread) {
      const permalink = threadMsgs.find((m) => m.permalink)?.permalink;
      lines.push(`  Thread ${threadNum}${permalink ? ` (link: ${permalink})` : ""}:`);
      for (const m of threadMsgs.slice(0, 20)) {
        const text = m.text.replace(/\s+/g, " ").trim().slice(0, 300);
        lines.push(`  - ${m.author ?? "someone"}: ${text || "(no text, e.g. a file/attachment)"}`);
      }
      threadNum++;
    }
  }
  return lines.join("\n");
}

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

/** Build the prompt that asks the model to summarize already-gathered @mention facts. */
function buildMentionsSummaryPrompt(date: string, mentionFacts: string): string {
  return `You are generating the Mentions portion of the end-of-day activity log for ${date} (timezone America/Los_Angeles).

Below are Slack messages where other people @mentioned me on ${date}, across every channel and DM I have access to, grouped by channel/DM and then by thread (already collected — do not search for more, just summarize what's given). Bot-authored mentions have already been filtered out.

Produce a response in exactly this format, with no preamble:

MENTIONS:
<for each channel/DM below that has messages, a "**#channel-name**" (or "**DM with username**") heading line, followed by one top-level bullet ("- ") per thread. Each thread bullet must:
- Name who mentioned me and reason about *why* — e.g. are they asking me a direct question, requesting a review/approval, reporting something that needs my attention, looping me in as an FYI, asking me to make a decision? Infer this from the message content, even though you only see the mentioning message(s), not necessarily the full conversation.
- Cite concrete specifics (names, PR/issue links, error messages, what's actually being asked) rather than vague generalities like "someone mentioned me about something".
- End with a markdown link to the thread using its "link:" value from the facts below, formatted as "([view thread](<link>))". Omit this if no link was given for that thread.
- Use plain, professional language. Do not use emoji.
If a thread has multiple related sub-points, use nested "  - " bullets under the thread bullet instead of cramming everything into one sentence.
If there are no mentions below, output exactly "_No mentions found._">

Mentions for the day, grouped by channel/DM and thread:
${mentionFacts}`;
}

type SlackResult = { slackSection: string };
type MentionsResult = { mentionsSection: string };

/** Parse the model's SLACK: response into parts. */
export function parseSlackResponse(text: string): SlackResult {
  const slackIdx = text.indexOf("SLACK:");
  if (slackIdx === -1) {
    return { slackSection: "_Slack summary unavailable._" };
  }
  const slackSection = text.slice(slackIdx + "SLACK:".length).trim();
  return {
    slackSection: slackSection || "_No public Slack activity._",
  };
}

/** Parse the model's MENTIONS: response into parts. */
export function parseMentionsResponse(text: string): MentionsResult {
  const idx = text.indexOf("MENTIONS:");
  if (idx === -1) {
    return { mentionsSection: "_Mentions summary unavailable._" };
  }
  const mentionsSection = text.slice(idx + "MENTIONS:".length).trim();
  return {
    mentionsSection: mentionsSection || "_No mentions found._",
  };
}

/**
 * Post-process a model-generated per-channel bullet section (Slack or
 * Mentions): insert a blank line before each channel heading (the model
 * reliably keeps channel groups on consecutive lines despite prompt
 * instructions), then linkify any bare GitHub PR/issue URLs the model
 * preserved from the original messages using the same conventions as the
 * rest of the app (see src/lib/copilot.ts).
 */
async function formatBulletSection(section: string): Promise<string> {
  if (!section || section.startsWith("_")) return section; // fallback / "no activity" text
  const lines = section
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const out: string[] = [];
  for (const line of lines) {
    if (/^\*\*#?[^*]+\*\*/.test(line) && out.length > 0) out.push(""); // blank line before each new channel/DM heading
    out.push(line);
  }
  return linkifyGitHubMentions(out.join("\n"));
}

/**
 * Search Slack (via gh-slack) for the day's public messages, then call
 * Copilot with a plain (non-tool-calling) prompt to produce the narrative +
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

/**
 * Resolve my Slack user ID, search for @mentions of me across every
 * channel/DM on `date`, then call Copilot with a plain (non-tool-calling)
 * prompt to produce the per-channel/DM Mentions summary. Returns a graceful
 * fallback on any failure — mirrors `fetchSlackSummary`.
 */
async function fetchMentionsSummary(date: string): Promise<MentionsResult> {
  const team = slackTeam();
  if (!team) {
    console.log("[dailyActivity] Mentions: no SLACK_TEAM/GITHUB_ORG configured, skipping");
    return { mentionsSection: "_Mentions summary unavailable._" };
  }
  const myUserId = await getSlackUserId(team);
  if (!myUserId) {
    return { mentionsSection: "_Mentions summary unavailable._" };
  }
  const messages = await searchSlackMentions(date, team, myUserId);
  if (messages === null) {
    return { mentionsSection: "_Mentions summary unavailable._" };
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
      { prompt: buildMentionsSummaryPrompt(date, renderMentionFacts(messages)) },
      120_000,
    );
    const content = res?.data?.content ?? "";
    const parsed = parseMentionsResponse(content);
    return { mentionsSection: await formatBulletSection(parsed.mentionsSection) };
  } catch (e) {
    console.error("[dailyActivity] fetchMentionsSummary failed:", e);
    return { mentionsSection: "_Mentions summary unavailable._" };
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

  // Slack summary and Mentions summary are independent (different searches,
  // different prompts) so they can run concurrently.
  const [slack, mentions] = await Promise.all([
    fetchSlackSummary(date),
    fetchMentionsSummary(date),
  ]);
  const parts: DailyActivityParts = {
    gh,
    agent,
    slackSection: slack.slackSection,
    mentionsSection: mentions.mentionsSection,
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

/**
 * Whether `date`'s log already has a Daily Activity block. Used to stop
 * automatic (scheduler-driven) generation from clobbering an entry that's
 * already there — e.g. after a server restart resets the scheduler's
 * in-memory "already generated today" guard. Manual regeneration (the
 * button / API route calling `generateDailyActivity` directly) intentionally
 * bypasses this check, since that's an explicit user request to refresh it.
 */
export async function dailyActivityBlockExists(date: string): Promise<boolean> {
  if (!isValidDate(date)) return false;
  const existing = await readLog(date);
  return extractBlock(existing, DAILY_ACTIVITY_KEY) !== null;
}

/**
 * Save a standalone copy of `date`'s Daily Activity under
 * `summaries/YYYY-MM-DD-daily-activity.md`, so the evening snapshot persists
 * independently of later edits to the log's managed block. Reuses the
 * block already in the log if one exists (never regenerates/clobbers an
 * existing entry); only generates a fresh one if the log doesn't have it yet
 * (e.g. the earlier scheduler trigger failed or was skipped).
 */
export async function generateAndSaveDailyActivitySummary(date: string): Promise<string> {
  if (!isValidDate(date)) throw new Error("Invalid date");
  const existingLog = await readLog(date);
  const section = extractBlock(existingLog, DAILY_ACTIVITY_KEY) ?? (await generateDailyActivity(date));
  const filename = await writeSummary(`${date}-daily-activity.md`, section);
  commitWorkLog(`docs(activity): save daily activity summary ${filename}`);
  return filename;
}

