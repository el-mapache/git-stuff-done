import { NextRequest, NextResponse } from "next/server";
import { readScratchpad, writeScratchpad } from "@/lib/files";
import { linkifyWorkLog } from "@/lib/copilot";

export async function GET() {
  const content = await readScratchpad();
  return NextResponse.json({ content });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "linkify") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const content = await readScratchpad();
  if (!content.trim()) {
    return NextResponse.json({ success: false, message: "No scratchpad content to linkify" }, { status: 400 });
  }

  const linkifiedContent = await linkifyWorkLog(content);
  await writeScratchpad(linkifiedContent);
  return NextResponse.json({ success: true, content: linkifiedContent });
}

export async function PUT(request: NextRequest) {
  const { content } = (await request.json()) as { content: string };
  if (typeof content !== "string") {
    return NextResponse.json({ error: "Invalid content" }, { status: 400 });
  }
  await writeScratchpad(content);
  return NextResponse.json({ success: true });
}
