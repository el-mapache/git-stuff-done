import { NextResponse } from "next/server";
import { commitWorkLog } from "@/lib/git";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const message = (body as { message?: string }).message;
    const result = commitWorkLog(message);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { committed: false, message: String(err) },
      { status: 500 },
    );
  }
}
