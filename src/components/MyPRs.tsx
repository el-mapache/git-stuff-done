'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO_PRS } from '@/lib/demo';
import { useVisibilityPolling } from '@/hooks/useVisibilityPolling';

type PullRequest = {
  id: number;
  number: number;
  title: string;
  url: string;
  repoFullName: string;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  inMergeQueue: boolean;
};

function timeAgo(dateString: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Module-level cache to survive remounts (e.g. layout switches)
let _prCache: PullRequest[] | null = null;

export default function MyPRs({ isDemo = false, onInsert }: { isDemo?: boolean; onInsert?: (text: string) => void }) {
  const [prs, setPrs] = useState<PullRequest[]>(_prCache ?? []);
  const [loading, setLoading] = useState(_prCache === null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    try {
      if (isDemo) {
        setPrs(DEMO_PRS);
        setLoading(false);
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const res = await fetch('/api/prs', { signal: controller.signal });
      const data: PullRequest[] = await res.json();
      setPrs(data);
      _prCache = data;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // keep existing data on error
    } finally {
      setLoading(false);
    }
  }, [isDemo]);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityPolling(refresh, 120_000);
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-primary">🔀 My PRs</h2>
        <button
          onClick={refresh}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="Refresh PRs"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Loading…</div>
        ) : prs.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">No open PRs 🎉</div>
        ) : (
          <ul className="divide-y divide-border">
            {prs.map((pr) => (
              <li key={pr.id} className="group px-4 py-3 transition-colors hover:bg-muted/50">
                <div className="flex items-start gap-2">
                  {onInsert && (
                    <button
                      onClick={() => onInsert(`[${pr.repoFullName}#${pr.number} ${pr.title}](${pr.url})`)}
                      title="Insert link at cursor"
                      className="mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                        <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h9A1.5 1.5 0 0 1 14 4.5v5a1.5 1.5 0 0 1-1.5 1.5H9.56l.97.97a.75.75 0 1 1-1.06 1.06l-2.25-2.25a.75.75 0 0 1 0-1.06l2.25-2.25a.75.75 0 0 1 1.06 1.06l-.97.97h2.94a.25.25 0 0 0 .25-.25v-5a.25.25 0 0 0-.25-.25h-9a.25.25 0 0 0-.25.25v2a.75.75 0 0 1-1.5 0v-2z"/>
                      </svg>
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <a
                        href={pr.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 flex-1 text-sm font-medium text-foreground hover:text-primary transition-colors block truncate"
                      >
                        {pr.draft && (
                          <span className="mr-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            DRAFT
                          </span>
                        )}
                        {pr.inMergeQueue && (
                          <span className="mr-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
                            QUEUED
                          </span>
                        )}
                        {pr.title}
                      </a>
                      <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">{timeAgo(pr.updatedAt)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">{pr.repoFullName}#{pr.number}</span>
                      <span className="text-xs text-emerald-500">+{pr.additions}</span>
                      <span className="text-xs text-destructive">-{pr.deletions}</span>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
