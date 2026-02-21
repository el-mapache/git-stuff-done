import { NextRequest, NextResponse } from "next/server";
import { getTodayDate, readLog, writeLog } from "@/lib/files";

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date") || getTodayDate();
  const content = await readLog(date);
  return NextResponse.json({ content, date });
}

export async function PUT(request: NextRequest) {
  const { date, content } = (await request.json()) as {
    date: string;
    content: string;
  };
  await writeLog(date, content);
  return NextResponse.json({ success: true });
}
