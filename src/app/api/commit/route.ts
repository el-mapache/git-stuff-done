import { NextResponse } from "next/server";
import { commitWorkLog } from "@/lib/git";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const message = (body as { message?: string }).message;
    console.log("[commit] Triggering commit...", message ? `message: "${message}"` : "(auto)");
    const result = commitWorkLog(message);
    console.log("[commit] Result:", result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[commit] Error:", err);
    return NextResponse.json(
      { committed: false, message: String(err) },
      { status: 500 },
    );
  }
}
