'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEMO_PRS } from '@/lib/demo';

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

export default function MyPRs({ isDemo = false }: { isDemo?: boolean }) {
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      if (isDemo) {
        setPrs(DEMO_PRS);
        setLoading(false);
        return;
      }
      const res = await fetch('/api/prs');
      const data: PullRequest[] = await res.json();
      setPrs(data);
    } catch { /* keep existing */ }
    finally { setLoading(false); }
  }, [isDemo]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 120_000);
    return () => clearInterval(id);
  }, [refresh]);

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
              <li key={pr.id} className="px-4 py-3 transition-colors hover:bg-muted/50">
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
                    {pr.title}
                  </a>
                  <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap ml-2">{timeAgo(pr.updatedAt)}</span>
                </div>
                <div className="mt-1 flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{pr.repoFullName}#{pr.number}</span>
                  <span className="text-xs text-emerald-500">+{pr.additions}</span>
                  <span className="text-xs text-destructive">-{pr.deletions}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
