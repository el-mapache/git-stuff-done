import { NextResponse } from 'next/server';
import { fetchMyPRs } from '@/lib/github';

export async function GET() {
  try {
    console.log("[prs] Fetching my open PRs...");
    const prs = await fetchMyPRs();
    console.log("[prs] Found", prs.length, "open PRs");
    return NextResponse.json(prs);
  } catch (error) {
    console.error("[prs] Failed to fetch:", error);
    return NextResponse.json([]);
  }
}
