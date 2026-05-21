import { NextRequest, NextResponse } from "next/server";
import { readScratchpad, writeScratchpad } from "@/lib/files";

export async function GET() {
  const content = await readScratchpad();
  return NextResponse.json({ content });
}

export async function PUT(request: NextRequest) {
  const { content } = (await request.json()) as { content: string };
  if (typeof content !== "string") {
    return NextResponse.json({ error: "Invalid content" }, { status: 400 });
  }
  await writeScratchpad(content);
  return NextResponse.json({ success: true });
}
