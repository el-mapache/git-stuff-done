'use client';

import { useCallback, useEffect, useState } from 'react';
import RawWorkLog from './RawWorkLog';
import RichWorkLog from './RichWorkLog';
import TodoList from './TodoList';
import GitHubNotifications from './GitHubNotifications';
import { GITHUB_ORG } from '@/lib/constants';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function Dashboard() {
  const [committing, setCommitting] = useState(false);
  const [commitMsg, setCommitMsg] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());

  function shiftDate(days: number) {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().slice(0, 10));
  }

  const isToday = date === todayISO();

  const [showSettings, setShowSettings] = useState(false);
  const [ignoredRepos, setIgnoredRepos] = useState<string[]>([]);
  const [repoInput, setRepoInput] = useState('');
  const [notifsKey, setNotifsKey] = useState(0);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      setIgnoredRepos(data.ignoredRepos ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  async function saveIgnoredRepos(repos: string[]) {
    setIgnoredRepos(repos);
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ignoredRepos: repos }),
    });
    setNotifsKey((k) => k + 1);
  }

  async function addIgnoredRepo() {
    const repo = repoInput.trim();
    if (!repo || ignoredRepos.includes(repo)) return;
    setRepoInput('');
    await saveIgnoredRepos([...ignoredRepos, repo]);
  }

  async function removeIgnoredRepo(repo: string) {
    await saveIgnoredRepos(ignoredRepos.filter((r) => r !== repo));
  }

  async function handleCommit() {
    setCommitting(true);
    try {
      const res = await fetch('/api/commit', { method: 'POST' });
      const data = await res.json();
      if (data.committed) {
        setCommitMsg('✓ Committed');
      } else {
        setCommitMsg(data.message || 'Nothing to commit');
      }
      setTimeout(() => setCommitMsg(null), 3000);
    } catch {
      setCommitMsg('Commit failed');
      setTimeout(() => setCommitMsg(null), 3000);
    } finally {
      setCommitting(false);
    }
  }

  const displayDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-6 py-3">
        <h1 className="text-xl font-bold tracking-tight">LogPilot</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => shiftDate(-1)}
            className="rounded-md px-2 py-1 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            ←
          </button>
          <span className="text-sm text-zinc-400">{displayDate}</span>
          {!isToday && (
            <button
              onClick={() => shiftDate(1)}
              className="rounded-md px-2 py-1 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              →
            </button>
          )}
          {!isToday && (
            <button
              onClick={() => setDate(todayISO())}
              className="rounded-md px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              Today
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {commitMsg && (
            <span className="text-xs text-zinc-400">{commitMsg}</span>
          )}
          <button
            onClick={handleCommit}
            disabled={committing}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {committing ? 'Committing…' : 'Commit Now'}
          </button>
          <button
            onClick={() => setShowSettings((s) => !s)}
            className="rounded-md px-2 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Settings"
          >
            ⚙
          </button>
        </div>
      </header>

      {/* Settings panel */}
      {showSettings && (
        <div className="border-b border-zinc-800 bg-zinc-900 px-6 py-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-zinc-200">Ignored Repos <span className="text-zinc-500 font-normal">(in {GITHUB_ORG} org)</span></h3>
            <button onClick={() => setShowSettings(false)} className="text-xs text-zinc-500 hover:text-zinc-300">Close</button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); addIgnoredRepo(); }} className="flex gap-2 mb-2">
            <input
              type="text"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="repo-name"
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-indigo-500"
            />
            <button type="submit" className="rounded-lg bg-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-100 transition hover:bg-zinc-600">Add</button>
          </form>
          {ignoredRepos.length === 0 ? (
            <p className="text-xs text-zinc-500">No repos ignored. Notifications and enrichment include all repos.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {ignoredRepos.map((repo) => (
                <span key={repo} className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300">
                  {repo}
                  <button onClick={() => removeIgnoredRepo(repo)} className="text-zinc-500 hover:text-red-400">✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Grid */}
      <div className="grid min-h-0 flex-1 grid-cols-[3fr_2fr] grid-rows-2 gap-3 p-3">
        <div className="overflow-auto rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <RawWorkLog date={date} />
        </div>
        <div className="overflow-auto rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <TodoList />
        </div>
        <div className="overflow-auto rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <RichWorkLog date={date} />
        </div>
        <div className="overflow-auto rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <GitHubNotifications key={notifsKey} />
        </div>
      </div>
    </div>
  );
}
