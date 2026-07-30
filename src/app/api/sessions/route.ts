import { NextResponse } from 'next/server';
import { fetchAgentTasks, type AgentSession } from '@/lib/agentTasks';

export type { AgentSession };

export async function GET() {
  try {
    const raw = await fetchAgentTasks(30);
    const sessions: AgentSession[] = raw
      .filter((s) => s.pullRequestNumber !== null && s.pullRequestState !== 'MERGED')
      .map((s) => {
        const prUrl = s.pullRequestUrl ?? (s.repository && s.pullRequestNumber
          ? `https://github.com/${s.repository}/pull/${s.pullRequestNumber}`
          : null);
        return {
          ...s,
          pullRequestUrl: prUrl,
          taskUrl: prUrl ? `${prUrl}/agent-sessions/${s.id}` : null,
        };
      });
    console.log(`[sessions] Returning ${sessions.length} agent tasks`);
    return NextResponse.json(sessions);
  } catch (err) {
    const isNotFound =
      err instanceof Error &&
      (err.message.includes('executable file not found') ||
        err.message.includes('command not found'));
    console.error('[sessions] Failed to fetch agent tasks:', err);
    return NextResponse.json([], { status: isNotFound ? 503 : 500 });
  }
}
