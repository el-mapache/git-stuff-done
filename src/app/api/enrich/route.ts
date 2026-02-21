import { NextRequest, NextResponse } from 'next/server';
import { getTodayDate, readLog, writeRichLog } from '@/lib/files';
import { enrichWorkLog } from '@/lib/copilot';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const date = (body as { date?: string }).date || getTodayDate();

    const raw = await readLog(date);
    if (!raw.trim()) {
      return NextResponse.json(
        { success: false, message: 'No log content to enrich' },
        { status: 400 },
      );
    }

    const content = await enrichWorkLog(raw);
    await writeRichLog(date, content);

    return NextResponse.json({ success: true, content });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, message },
      { status: 500 },
    );
  }
}
