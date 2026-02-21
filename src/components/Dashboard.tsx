'use client';

import { useState } from 'react';
import RawWorkLog from './RawWorkLog';
import RichWorkLog from './RichWorkLog';
import TodoList from './TodoList';
import GitHubNotifications from './GitHubNotifications';

function todayString() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function Dashboard() {
  const [committing, setCommitting] = useState(false);

  async function handleCommit() {
    setCommitting(true);
    try {
      await fetch('/api/commit', { method: 'POST' });
    } finally {
      setCommitting(false);
    }
  }

  const date = todayISO();

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-6 py-3">
        <h1 className="text-xl font-bold tracking-tight">LogPilot</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-400">{todayString()}</span>
          <button
            onClick={handleCommit}
            disabled={committing}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {committing ? 'Committing…' : 'Commit Now'}
          </button>
        </div>
      </header>

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
          <GitHubNotifications />
        </div>
      </div>
    </div>
  );
}
