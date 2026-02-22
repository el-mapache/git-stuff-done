import { execFileSync } from "child_process";
import { getTodayDate, getDataRoot } from "./files";

export function commitWorkLog(
  message?: string,
): { committed: boolean; message: string } {
  const cwd = getDataRoot();

  // Stage logs/, summaries/ and data/ directories
  // Note: execFileSync args are not shell-expanded, so we add directories individually
  // But git add accepts multiple pathspecs
  try {
      execFileSync("git", ["add", "logs", "data", "summaries"], { cwd });
  } catch (e) {
      // Ignore if directories don't exist yet (git add might warn)
  }

  // Check if there is anything staged to commit
  const status = execFileSync("git", ["diff", "--cached", "--name-only"], {
    cwd,
    encoding: "utf-8",
  }).trim();

  if (!status) {
    return { committed: false, message: "Nothing to commit" };
  }

  const now = new Date();
  const timestamp = now.toISOString().slice(0, 16).replace("T", " ");
  const commitMessage = message ?? `Update work log ${timestamp}`;

  execFileSync("git", ["commit", "-m", commitMessage], { cwd });

  // Push to remote if configured
  try {
    execFileSync("git", ["push"], { cwd });
  } catch {
    // Push may fail if no remote is set; commit still succeeded
  }

  return { committed: true, message: commitMessage };
}

export function isNewDay(lastDate: string): boolean {
  return getTodayDate() !== lastDate;
}
