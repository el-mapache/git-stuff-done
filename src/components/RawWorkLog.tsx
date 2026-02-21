'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved';

interface RawWorkLogProps {
  date?: string;
}

function getTodayLocal(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function RawWorkLog({ date }: RawWorkLogProps) {
  const currentDate = date ?? getTodayLocal();
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef(content);

  // Fetch log on mount or when date changes
  useEffect(() => {
    let cancelled = false;
    async function fetchLog() {
      const res = await fetch(`/api/log?date=${currentDate}`);
      const data = await res.json();
      if (!cancelled) {
        setContent(data.content);
        latestContentRef.current = data.content;
        setStatus('idle');
      }
    }
    fetchLog();
    return () => { cancelled = true; };
  }, [currentDate]);

  const save = useCallback(async (text: string) => {
    setStatus('saving');
    try {
      await fetch('/api/log', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: currentDate, content: text }),
      });
      setStatus('saved');
    } catch {
      setStatus('unsaved');
    }
  }, [currentDate]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setContent(text);
    latestContentRef.current = text;
    setStatus('unsaved');

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      save(latestContentRef.current);
    }, 1000);
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const statusLabel: Record<SaveStatus, string> = {
    idle: '',
    unsaved: 'Unsaved changes',
    saving: 'Saving...',
    saved: 'Saved',
  };

  const statusColor: Record<SaveStatus, string> = {
    idle: 'text-zinc-500',
    unsaved: 'text-amber-400',
    saving: 'text-blue-400',
    saved: 'text-emerald-400',
  };

  return (
    <div className="flex h-full flex-col bg-zinc-900 rounded-lg border border-zinc-700">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
        <span className="text-sm font-medium text-zinc-300">
          📝 Raw Log — {currentDate}
        </span>
        {status !== 'idle' && (
          <span className={`text-xs ${statusColor[status]}`}>
            {statusLabel[status]}
          </span>
        )}
      </div>
      <textarea
        className="flex-1 w-full resize-none bg-zinc-950 p-3 font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
        value={content}
        onChange={handleChange}
        placeholder="Start typing your work log..."
        spellCheck={false}
      />
    </div>
  );
}
