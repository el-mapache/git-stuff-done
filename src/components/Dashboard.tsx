'use client';

import { useCallback, useEffect, useState } from 'react';
import RawWorkLog from './RawWorkLog';
import RichWorkLog from './RichWorkLog';
import TodoList from './TodoList';
import GitHubNotifications from './GitHubNotifications';
import { GITHUB_ORG } from '@/lib/constants';

function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

export default function Dashboard() {
  const [committing, setCommitting] = useState(false);
  const [commitMsg, setCommitMsg] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());

  function shiftDate(days: number) {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + days);
    setDate(d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }));
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

  const displayDate = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="flex h-screen flex-col bg-amber-50/40 text-zinc-800">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-amber-200 bg-white px-6 py-3 shadow-sm">
        <span className="text-lg font-bold tracking-tight">✨ get stuff done</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => shiftDate(-1)}
            className="rounded-md px-2 py-1 text-sm text-zinc-500 transition hover:bg-amber-100 hover:text-zinc-800"
          >
            ←
          </button>
          <span className="text-sm font-medium text-zinc-600">{displayDate}</span>
          {!isToday && (
            <button
              onClick={() => shiftDate(1)}
              className="rounded-md px-2 py-1 text-sm text-zinc-500 transition hover:bg-amber-100 hover:text-zinc-800"
            >
              →
            </button>
          )}
          {!isToday && (
            <button
              onClick={() => setDate(todayISO())}
              className="rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-200"
            >
              Today
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {commitMsg && (
            <span className="text-xs text-emerald-600 font-medium">{commitMsg}</span>
          )}
          <button
            onClick={handleCommit}
            disabled={committing}
            className="rounded-lg bg-violet-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-600 disabled:opacity-50"
          >
            {committing ? 'Committing…' : '🚀 Commit & Push'}
          </button>
          <button
            onClick={() => setShowSettings((s) => !s)}
            className="rounded-md px-2 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
            aria-label="Settings"
          >
            ⚙️
          </button>
        </div>
      </header>

      {/* Settings panel */}
      {showSettings && (
        <div className="border-b border-amber-200 bg-white px-6 py-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-zinc-700">Ignored Repos <span className="text-zinc-400 font-normal">(in {GITHUB_ORG} org)</span></h3>
            <button onClick={() => setShowSettings(false)} className="text-xs text-zinc-400 hover:text-zinc-600">Close</button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); addIgnoredRepo(); }} className="flex gap-2 mb-2">
            <input
              type="text"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="repo-name"
              className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-800 placeholder-zinc-400 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200"
            />
            <button type="submit" className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200">Add</button>
          </form>
          {ignoredRepos.length === 0 ? (
            <p className="text-xs text-zinc-400">No repos ignored. Notifications and enrichment include all repos.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {ignoredRepos.map((repo) => (
                <span key={repo} className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-3 py-1 text-xs text-rose-600">
                  {repo}
                  <button onClick={() => removeIgnoredRepo(repo)} className="text-rose-400 hover:text-rose-600">✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Grid */}
      <div className="grid min-h-0 flex-1 grid-cols-[3fr_2fr] grid-rows-2 gap-3 p-3">
        <div className="overflow-auto rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <RawWorkLog date={date} />
        </div>
        <div className="overflow-auto rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <TodoList />
        </div>
        <div className="overflow-auto rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <RichWorkLog date={date} />
        </div>
        <div className="overflow-auto rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <GitHubNotifications key={notifsKey} />
        </div>
      </div>
    </div>
  );
}
