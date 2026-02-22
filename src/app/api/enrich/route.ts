import { NextRequest, NextResponse } from 'next/server';
import { getTodayDate, readLog, writeRichLog } from '@/lib/files';
import { enrichWorkLog } from '@/lib/copilot';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const date = (body as { date?: string }).date || getTodayDate();
    console.log("[enrich] Enriching log for", date);

    const raw = await readLog(date);
    if (!raw.trim()) {
      console.log("[enrich] No log content for", date);
      return NextResponse.json(
        { success: false, message: 'No log content to enrich' },
        { status: 400 },
      );
    }

    console.log("[enrich] Raw log:", raw.length, "chars — calling AI...");
    const content = await enrichWorkLog(raw);
    await writeRichLog(date, content);
    console.log("[enrich] Done — enriched log:", content.length, "chars");

    return NextResponse.json({ success: true, content });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error("[enrich] Error:", message);
    return NextResponse.json(
      { success: false, message },
      { status: 500 },
    );
  }
}
