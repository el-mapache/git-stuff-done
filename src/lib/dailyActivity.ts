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

  // Slack + narrative are wired in a later task. Placeholder for now.
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
