'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const MDEditor = dynamic(() => import('@uiw/react-md-editor'), { ssr: false });

type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved';

interface RawWorkLogProps {
  date?: string;
  onContentSaved?: () => void;
}

function getTodayLocal(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

export default function RawWorkLog({ date, onContentSaved }: RawWorkLogProps) {
  const currentDate = date ?? getTodayLocal();
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef(content);

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
      onContentSaved?.();
    } catch {
      setStatus('unsaved');
    }
  }, [currentDate, onContentSaved]);

  const handleChange = (value?: string) => {
    const text = value ?? '';
    setContent(text);
    latestContentRef.current = text;
    setStatus('unsaved');

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      save(latestContentRef.current);
    }, 1000);
  };

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
    idle: 'text-zinc-400',
    unsaved: 'text-amber-500',
    saving: 'text-violet-500',
    saved: 'text-emerald-500',
  };

  return (
    <div className="flex h-full flex-col rounded-lg border border-zinc-200">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 bg-zinc-50 rounded-t-lg">
        <span className="text-sm font-semibold text-zinc-600">
          📝 Raw Log — {currentDate}
        </span>
        {status !== 'idle' && (
          <span className={`text-xs font-medium ${statusColor[status]}`}>
            {statusLabel[status]}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto rounded-b-lg" data-color-mode="light">
        <MDEditor
          value={content}
          onChange={handleChange}
          preview="edit"
          hideToolbar={false}
          height="100%"
          visibleDragbar={false}
          style={{ background: 'white', minHeight: '100%' }}
        />
      </div>
    </div>
  );
}
