import { commitWorkLog, isNewDay } from "./git";
import { getTodayDate, readConfig } from "./files";
import { generateDailyActivity, generateAndSaveDailyActivitySummary, dailyActivityBlockExists } from "./dailyActivity";

let intervalId: ReturnType<typeof setInterval> | null = null;
let lastDate: string = getTodayDate();
let lastGeneratedDate: string | null = null;
let generating = false;

// Cap retries so a persistent failure (e.g. broken Slack auth) doesn't
// re-trigger generation (including the Slack API call and a git commit)
// every hour for the rest of the day.
const MAX_ATTEMPTS_PER_DAY = 3;
let attemptDate: string | null = null;
let attemptCount = 0;

// Same guard, but for the separate later "save a standalone summary file" trigger.
let lastSavedDate: string | null = null;
let saving = false;
let saveAttemptDate: string | null = null;
let saveAttemptCount = 0;

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
  if (attemptDate !== today) {
    attemptDate = today;
    attemptCount = 0;
  }
  if (attemptCount >= MAX_ATTEMPTS_PER_DAY) return;
  let hour = 18;
  try {
    hour = (await readConfig()).dailyActivityHour;
  } catch {
    /* use default */
  }
  if (currentHourPT() < hour) return;

  // Don't auto-insert a new summary if the log already has one for today —
  // e.g. a server restart would otherwise reset the in-memory guards above
  // and cause the scheduler to regenerate (and clobber) an existing entry.
  try {
    if (await dailyActivityBlockExists(today)) {
      lastGeneratedDate = today;
      return;
    }
  } catch (err) {
    console.error("Scheduler: failed to check for existing daily activity block", err);
  }

  generating = true;
  attemptCount++;
  try {
    console.log(`Scheduler: generating daily activity for ${today} (attempt ${attemptCount}/${MAX_ATTEMPTS_PER_DAY})`);
    await generateDailyActivity(today);
    lastGeneratedDate = today;
    console.log(`Scheduler: daily activity generated for ${today}`);
  } catch (err) {
    console.error("Scheduler: daily activity generation failed", err);
    if (attemptCount >= MAX_ATTEMPTS_PER_DAY) {
      console.error(`Scheduler: giving up on daily activity for ${today} after ${attemptCount} attempts`);
    }
    // Leave lastGeneratedDate unset so a later tick retries, up to the cap above.
  } finally {
    generating = false;
  }
}

/** Later in the evening (default 8pm), save a standalone summaries/ copy of the day's Daily Activity block — reusing what's already in the log rather than regenerating/clobbering it (see generateAndSaveDailyActivitySummary). */
async function maybeSaveDailySummaryFile(): Promise<void> {
  if (saving) return;
  const today = getTodayDate();
  if (lastSavedDate === today) return;
  if (saveAttemptDate !== today) {
    saveAttemptDate = today;
    saveAttemptCount = 0;
  }
  if (saveAttemptCount >= MAX_ATTEMPTS_PER_DAY) return;
  let hour = 20;
  try {
    hour = (await readConfig()).dailySummaryFileHour;
  } catch {
    /* use default */
  }
  if (currentHourPT() < hour) return;

  saving = true;
  saveAttemptCount++;
  try {
    console.log(`Scheduler: saving daily activity summary file for ${today} (attempt ${saveAttemptCount}/${MAX_ATTEMPTS_PER_DAY})`);
    const filename = await generateAndSaveDailyActivitySummary(today);
    lastSavedDate = today;
    console.log(`Scheduler: daily activity summary file saved: ${filename}`);
  } catch (err) {
    console.error("Scheduler: daily activity summary file save failed", err);
    if (saveAttemptCount >= MAX_ATTEMPTS_PER_DAY) {
      console.error(`Scheduler: giving up on daily activity summary file for ${today} after ${saveAttemptCount} attempts`);
    }
    // Leave lastSavedDate unset so a later tick retries, up to the cap above.
  } finally {
    saving = false;
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
  void maybeSaveDailySummaryFile();
}

export function startScheduler(): void {
  if (intervalId) return; // guard against double-start
  console.log("Scheduler: started (hourly auto-commit + evening daily activity + evening summary file save)");
  intervalId = setInterval(tick, 60 * 60 * 1000);
}

export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("Scheduler: stopped");
  }
}
