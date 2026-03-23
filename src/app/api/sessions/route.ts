import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

export type AgentSession = {
  id: string;
  repository: string;
  branch: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  fileCount: number;
  refs: { type: string; value: string }[];
};

const DB_PATH = path.join(os.homedir(), '.copilot', 'session-store.db');

export async function GET() {
  try {
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

    const rows = db.prepare(`
      SELECT
        s.id,
        s.repository,
        s.branch,
        s.summary,
        s.created_at   AS createdAt,
        s.updated_at   AS updatedAt,
        COUNT(DISTINCT t.turn_index) AS turnCount,
        COUNT(DISTINCT sf.file_path) AS fileCount,
        GROUP_CONCAT(DISTINCT sr.ref_type || ':' || sr.ref_value) AS refsRaw
      FROM sessions s
      LEFT JOIN turns t  ON t.session_id  = s.id
      LEFT JOIN session_files sf ON sf.session_id = s.id
      LEFT JOIN session_refs sr  ON sr.session_id  = s.id
      WHERE s.summary IS NOT NULL
        AND s.summary NOT LIKE 'You are a helpful assistant%'
        AND length(trim(s.summary)) > 0
      GROUP BY s.id
      ORDER BY s.created_at DESC
      LIMIT 50
    `).all() as Array<{
      id: string;
      repository: string;
      branch: string;
      summary: string;
      createdAt: string;
      updatedAt: string;
      turnCount: number;
      fileCount: number;
      refsRaw: string | null;
    }>;

    db.close();

    const sessions: AgentSession[] = rows.map((row) => ({
      id: row.id,
      repository: row.repository ?? '',
      branch: row.branch ?? '',
      summary: row.summary,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      turnCount: row.turnCount ?? 0,
      fileCount: row.fileCount ?? 0,
      refs: row.refsRaw
        ? row.refsRaw.split(',').map((r) => {
            const [type, ...rest] = r.split(':');
            return { type, value: rest.join(':') };
          })
        : [],
    }));

    console.log(`[sessions] Returning ${sessions.length} sessions`);
    return NextResponse.json(sessions);
  } catch (err) {
    console.error('[sessions] Failed to read session store:', err);
    return NextResponse.json([]);
  }
}
