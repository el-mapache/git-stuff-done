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
    // `gh agent-task list` requires a token from an interactive `gh auth login`
    // (keyring-stored OAuth session) and rejects tokens supplied via
    // GITHUB_TOKEN/GH_TOKEN env vars with "this command requires an OAuth
    // token", even though those env vars work fine for other gh/Octokit
    // calls in this app. Strip them here so gh falls back to its stored
    // keyring credential instead of the (incompatible) env-provided one.
    const envWithoutGhTokens = { ...process.env };
    delete envWithoutGhTokens.GITHUB_TOKEN;
    delete envWithoutGhTokens.GH_TOKEN;
    const { stdout } = await execAsync(
      `gh agent-task list --json ${GH_FIELDS} --limit ${limit}`,
      { env: { ...envWithoutGhTokens, NO_COLOR: "1" } }
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
