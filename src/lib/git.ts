import { execSync } from "child_process";
import { getTodayDate } from "./files";

export function commitWorkLog(
  message?: string,
): { committed: boolean; message: string } {
  const cwd = process.cwd();

  // Stage logs/ and data/ directories
  execSync("git add logs/ data/", { cwd });

  // Check if there is anything staged to commit
  const status = execSync("git diff --cached --name-only", {
    cwd,
    encoding: "utf-8",
  }).trim();

  if (!status) {
    return { committed: false, message: "Nothing to commit" };
  }

  const now = new Date();
  const timestamp = now.toISOString().slice(0, 16).replace("T", " ");
  const commitMessage = message ?? `Update work log ${timestamp}`;

  execSync(`git commit -m ${JSON.stringify(commitMessage)}`, { cwd });

  return { committed: true, message: commitMessage };
}

export function isNewDay(lastDate: string): boolean {
  return getTodayDate() !== lastDate;
}
