import { NextRequest, NextResponse } from 'next/server';
import { getTodayDate, readLog, writeLog, isValidDate } from '@/lib/files';
import { linkifyWorkLog } from '@/lib/copilot';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const date = (body as { date?: string }).date || getTodayDate();
    if (!isValidDate(date)) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }
    console.log("[linkify] Linkifying log for", date);

    const raw = await readLog(date);
    if (!raw.trim()) {
      console.log("[linkify] No log content for", date);
      return NextResponse.json(
        { success: false, message: 'No log content to linkify' },
        { status: 400 },
      );
    }

    console.log("[linkify] Raw log:", raw.length, "chars — linkifying...");
    const content = await linkifyWorkLog(raw);
    await writeLog(date, content);
    console.log("[linkify] Done — linkified log:", content.length, "chars");

    return NextResponse.json({ success: true, content });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error("[linkify] Error:", message);
    return NextResponse.json(
      { success: false, message },
      { status: 500 },
    );
  }
}
