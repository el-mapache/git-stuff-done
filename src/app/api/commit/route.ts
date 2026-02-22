import { NextResponse } from "next/server";
import { commitWorkLog } from "@/lib/git";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    let message = (body as { message?: string }).message;
    if (message) {
      // Sanitize: limit length, strip control characters
      message = message.slice(0, 200).replace(/[\x00-\x1f]/g, "");
    }
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
