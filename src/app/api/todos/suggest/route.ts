import { NextResponse } from "next/server";
import { readLog, getTodayDate } from "@/lib/files";
import { getGitHubToken } from "@/lib/github";

const MODELS_API = "https://models.inference.ai.azure.com/chat/completions";
const MODEL = "gpt-4o";

export async function POST() {
  console.log("[suggest] Generating TODO suggestions...");
  const today = getTodayDate();
  const log = await readLog(today);
  if (!log.trim()) {
    console.log("[suggest] No log content for", today, "— returning empty suggestions");
    return NextResponse.json({ suggestions: [] });
  }

  console.log("[suggest] Log content length:", log.length, "chars");
  const token = await getGitHubToken();

  const res = await fetch(MODELS_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `You are a productivity assistant. Given a developer's work log, suggest 3-5 actionable TODO items for follow-up work. Return ONLY a JSON array of strings, e.g. ["Review PR feedback","Write tests for auth module"]. No extra text.`,
        },
        {
          role: "user",
          content: log,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[suggest] Models API error:", res.status, body);
    return NextResponse.json(
      { error: `Models API error ${res.status}: ${body}` },
      { status: 502 },
    );
  }

  const data = await res.json();
  const raw: string = data.choices?.[0]?.message?.content ?? "[]";
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
}
