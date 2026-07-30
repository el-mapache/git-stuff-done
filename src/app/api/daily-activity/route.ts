import { NextResponse } from "next/server";
import { isValidDate, getTodayDate } from "@/lib/files";
import { generateDailyActivity } from "@/lib/dailyActivity";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const date = (body as { date?: string }).date || getTodayDate();
    if (!isValidDate(date)) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }
    // generateDailyActivity itself coalesces concurrent calls for the same
    // date (shared with the evening scheduler), so no local guard needed here.
    const section = await generateDailyActivity(date);
    return NextResponse.json({ success: true, date, section });
  } catch (err) {
    console.error("[daily-activity] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate daily activity" },
      { status: 500 },
    );
  }
}

