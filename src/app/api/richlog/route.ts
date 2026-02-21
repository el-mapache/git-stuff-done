import { NextRequest, NextResponse } from 'next/server';
import { getTodayDate, readRichLog } from '@/lib/files';

export async function GET(request: NextRequest) {
  const date =
    request.nextUrl.searchParams.get('date') || getTodayDate();
  const content = await readRichLog(date);
  return NextResponse.json({ content, date });
}
