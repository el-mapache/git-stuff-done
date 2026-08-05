export const GITHUB_ORG = process.env.GITHUB_ORG || '';

/** Managed-block key for the Daily Activity section, shared between the server orchestrator (dailyActivity.ts) and the client button (RawWorkLog.tsx) so both sides upsert the same block. */
export const DAILY_ACTIVITY_KEY = "daily-activity";

/** The login used in API calls to assign the Copilot coding agent. */
export const COPILOT_AGENT_LOGIN = "copilot-swe-agent[bot]";

const COPILOT_LOGINS = new Set(["copilot", "copilot-swe-agent", "copilot-swe-agent[bot]"]);

/** Check if a GitHub login belongs to the Copilot coding agent (case-insensitive). */
export function isCopilotLogin(login: string): boolean {
  return COPILOT_LOGINS.has(login.toLowerCase());
}
