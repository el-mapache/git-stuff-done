import { NextRequest, NextResponse } from "next/server";
import { readLog, isValidDate } from "@/lib/files";
import { callCopilot } from "@/lib/copilot";

export async function POST(request: NextRequest) {
  console.log("[suggest] Generating TODO suggestions...");
  const body = await request.json().catch(() => ({}));
  const date = (body as { date?: string }).date;
  if (!date || !isValidDate(date)) {
    console.log("[suggest] No valid date provided");
    return NextResponse.json({ suggestions: [] });
  }

  // Use raw log for suggestions
  const log = await readLog(date);
  if (!log.trim()) {
    console.log("[suggest] No log content for", date, "— returning empty suggestions");
    return NextResponse.json({ suggestions: [] });
  }

  console.log("[suggest] Log content length:", log.length, "chars");

  try {
    const systemPrompt = `You are a productivity assistant. Given a developer's work log, suggest 1-3 actionable TODO items for follow-up work. Return ONLY a JSON array of strings, e.g. ["Review PR feedback","Write tests for auth module"]. It's ok to return an empty array. No extra text.`;

    const raw = await callCopilot(systemPrompt, log);
    console.log("[suggest] AI raw response:", raw);

    let suggestions: string[];
    try {
      suggestions = JSON.parse(raw);
      if (!Array.isArray(suggestions)) suggestions = [];
    } catch {
      console.warn("[suggest] Failed to parse JSON, falling back to line parsing");
      const lines = raw
        .split("\n")
        .map((l: string) => l.replace(/^[-*\d.)\s]+/, "").trim())
        .filter(Boolean);
      suggestions = lines.slice(0, 5);
    }

    console.log("[suggest] Returning", suggestions.length, "suggestions:", suggestions);
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("[suggest] Copilot SDK error:", error);
    return NextResponse.json(
      { error: `Copilot SDK error: ${error}` },
      { status: 502 },
    );
  }
}
