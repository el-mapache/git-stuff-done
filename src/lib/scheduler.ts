import { commitWorkLog, isNewDay } from "./git";
import { getTodayDate } from "./files";

let intervalId: ReturnType<typeof setInterval> | null = null;
let lastDate: string = getTodayDate();

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
}

export function startScheduler(): void {
  if (intervalId) return; // guard against double-start
  console.log("Scheduler: started (hourly auto-commit)");
  intervalId = setInterval(tick, 60 * 60 * 1000);
}

export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("Scheduler: stopped");
  }
}
