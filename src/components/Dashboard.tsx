'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useSearchParams } from 'next/navigation';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import RawWorkLog from './RawWorkLog';
import TodoList from './TodoList';
import MyPRs from './MyPRs';
import GitHubNotifications from './GitHubNotifications';
import SummaryModal from './SummaryModal';
import { GITHUB_ORG } from '@/lib/constants';

function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

export default function Dashboard() {
  const searchParams = useSearchParams();
  const isDemo = searchParams.get('demo') === 'true';

  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitMsg, setCommitMsg] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO);
  const [showSummary, setShowSummary] = useState(false);

  // Avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

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
    <div className="flex h-screen flex-col bg-background text-foreground transition-colors duration-300">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card/70 backdrop-blur-sm px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-primary to-pink-400 bg-clip-text text-transparent">✨ git stuff done</span>
          {isDemo && (
            <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-500 uppercase tracking-wide">
              Demo Mode
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => shiftDate(-1)}
            className="rounded-lg px-2 py-1 text-sm text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
          >
            ←
          </button>
          <span className="text-sm font-medium text-foreground">{displayDate}</span>
          {!isToday && (
            <button
              onClick={() => shiftDate(1)}
              className="rounded-lg px-2 py-1 text-sm text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
            >
              →
            </button>
          )}
          {!isToday && (
            <button
              onClick={() => setDate(todayISO())}
              className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground transition hover:opacity-80"
            >
              Today
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {commitMsg && (
            <span className="text-xs text-emerald-500 font-medium">{commitMsg}</span>
          )}
          <button
            onClick={handleCommit}
            disabled={committing || isDemo}
            title={isDemo ? 'Disabled in demo mode' : 'Push to GitHub'}
            className="rounded-xl bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            {committing ? 'Pushing…' : '🚀 Commit & Push'}
          </button>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
            aria-label="Toggle Theme"
          >
            {mounted ? (theme === 'dark' ? '🌙' : '☀️') : '…'}
          </button>
          <button
            onClick={() => setShowSummary(true)}
            className="rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
            aria-label="Summarize"
            title="Generate Summary"
          >
            📊
          </button>
          <button
            onClick={() => setShowSettings((s) => !s)}
            className="rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
            aria-label="Settings"
          >
            ⚙️
          </button>
        </div>
      </header>

      <SummaryModal
        isOpen={showSummary}
        onClose={() => setShowSummary(false)}
        defaultDate={date}
        isDemo={isDemo}
      />

      {/* Settings panel */}
      {showSettings && (
        <div className="border-b border-border bg-card/80 backdrop-blur-sm px-6 py-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-foreground">Ignored Repos <span className="text-muted-foreground font-normal">(in {GITHUB_ORG} org)</span></h3>
            <button onClick={() => setShowSettings(false)} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); addIgnoredRepo(); }} className="flex gap-2 mb-2">
            <input
              type="text"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="repo-name"
              className="flex-1 rounded-xl border border-input bg-muted/50 px-3 py-1.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
            />
            <button type="submit" className="rounded-xl bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground transition hover:opacity-80">Add</button>
          </form>
          {ignoredRepos.length === 0 ? (
            <p className="text-xs text-muted-foreground">No repos ignored.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {ignoredRepos.map((repo) => (
                <span key={repo} className="inline-flex items-center gap-1 rounded-full bg-secondary border border-border px-3 py-1 text-xs text-secondary-foreground font-medium">
                  {repo}
                  <button onClick={() => removeIgnoredRepo(repo)} className="text-muted-foreground hover:text-foreground">✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Resizable Grid: Left (Log + TODOs) | Right (PRs + Notifications) */}
      <PanelGroup orientation="horizontal" className="min-h-0 flex-1 p-3">
        {/* Left column: Log on top, TODOs on bottom */}
        <Panel defaultSize={55} minSize={30}>
          <PanelGroup orientation="vertical">
            <Panel defaultSize={60} minSize={20}>
              <div className="h-full overflow-auto rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-4 shadow-sm transition-colors">
                <RawWorkLog date={date} isDemo={isDemo} />
              </div>
            </Panel>
            <PanelResizeHandle className="my-1 h-1.5 rounded-full transition hover:bg-accent active:bg-primary/50" />
            <Panel defaultSize={40} minSize={15}>
              <div className="h-full overflow-auto rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-4 shadow-sm transition-colors">
                <TodoList date={date} isDemo={isDemo} />
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className="mx-1 w-1.5 rounded-full transition hover:bg-accent active:bg-primary/50" />
        {/* Right column: PRs on top, Notifications on bottom */}
        <Panel defaultSize={45} minSize={25}>
          <PanelGroup orientation="vertical">
            <Panel defaultSize={50} minSize={15}>
              <div className="h-full overflow-auto rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-4 shadow-sm transition-colors">
                <MyPRs isDemo={isDemo} />
              </div>
            </Panel>
            <PanelResizeHandle className="my-1 h-1.5 rounded-full transition hover:bg-accent active:bg-primary/50" />
            <Panel defaultSize={50} minSize={15}>
              <div className="h-full overflow-auto rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-4 shadow-sm transition-colors">
                <GitHubNotifications key={notifsKey} isDemo={isDemo} />
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>
    </div>
  );
}
