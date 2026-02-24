let initialized = false;

if (typeof window === "undefined" && !initialized && process.env.NEXT_PUBLIC_DEMO !== "true") {
  initialized = true;
  import("./scheduler").then(({ startScheduler }) => startScheduler());
}
