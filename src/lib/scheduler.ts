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
  } catch {
    /* use default */
  }
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
