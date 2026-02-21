import { startScheduler } from "./scheduler";

let initialized = false;

if (typeof window === "undefined" && !initialized) {
  initialized = true;
  startScheduler();
}
