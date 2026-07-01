import { NextResponse } from "next/server";
import { isValidDate, getTodayDate } from "@/lib/files";
import { generateDailyActivity } from "@/lib/dailyActivity";

export const maxDuration = 300;

// Shared in-flight guard so the scheduler and a manual click can't write at once.
let inFlight: Promise<string> | null = null;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const date = (body as { date?: string }).date || getTodayDate();
    if (!isValidDate(date)) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }
    if (!inFlight) {
      inFlight = generateDailyActivity(date).finally(() => {
        inFlight = null;
      });
    } else {
      console.log("[daily-activity] Coalescing with in-flight generation");
    }
    const section = await inFlight;
    return NextResponse.json({ success: true, date, section });
  } catch (err) {
    console.error("[daily-activity] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate daily activity" },
      { status: 500 },
    );
  }
}
