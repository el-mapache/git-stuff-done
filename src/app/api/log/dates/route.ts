import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import { getDataRoot } from "@/lib/files";
import path from "path";

export async function GET() {
  try {
    const logsDir = path.join(getDataRoot(), "logs");
    const files = await readdir(logsDir);
    // Return only YYYY-MM-DD.md raw log files (not .rich.md)
    const dates = files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map((f) => f.replace(".md", ""))
      .sort();
    return NextResponse.json({ dates });
  } catch {
    return NextResponse.json({ dates: [] });
  }
}
