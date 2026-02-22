import { NextRequest, NextResponse } from "next/server";
import { getTodayDate, readLog, writeLog } from "@/lib/files";

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date") || getTodayDate();
  const content = await readLog(date);
  console.log("[log] GET", date, "—", content.length, "chars");
  return NextResponse.json({ content, date });
}

export async function PUT(request: NextRequest) {
  const { date, content } = (await request.json()) as {
    date: string;
    content: string;
  };
  console.log("[log] PUT", date, "—", content.length, "chars");
  await writeLog(date, content);
  return NextResponse.json({ success: true });
}
