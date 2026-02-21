import { NextRequest, NextResponse } from "next/server";
import { readConfig, writeConfig } from "@/lib/files";

export async function GET() {
  const config = await readConfig();
  return NextResponse.json(config);
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const config = await readConfig();

  if (Array.isArray(body.ignoredRepos)) {
    config.ignoredRepos = body.ignoredRepos.map((r: string) => r.trim()).filter(Boolean);
  }

  await writeConfig(config);
  return NextResponse.json(config);
}
