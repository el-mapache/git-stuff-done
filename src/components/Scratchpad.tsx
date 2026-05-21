'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { StickyNote } from 'lucide-react';
import TiptapEditor, { type TiptapEditorHandle } from './TiptapEditor';

type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved';

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: '', unsaved: 'Unsaved changes', saving: 'Saving...', saved: 'Saved ✓',
};
const STATUS_COLOR: Record<SaveStatus, string> = {
  idle: 'text-muted-foreground', unsaved: 'text-amber-500', saving: 'text-primary', saved: 'text-emerald-500',
};

export default function Scratchpad({ isDemo = false }: { isDemo?: boolean }) {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef(content);
  const editorRef = useRef<TiptapEditorHandle>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchScratchpad() {
      if (isDemo) {
        setContent('# Scratchpad\n\nJot down anything here — it persists across days.');
        return;
      }
      const res = await fetch('/api/scratchpad');
      const data = await res.json();
      if (!cancelled) {
        setContent(data.content);
        latestContentRef.current = data.content;
        setStatus('idle');
      }
    }
    fetchScratchpad();
    return () => { cancelled = true; };
  }, [isDemo]);

  const save = useCallback(async (text: string) => {
    if (isDemo) return;
    setStatus('saving');
    try {
      await fetch('/api/scratchpad', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      setStatus('saved');
    } catch {
      setStatus('unsaved');
    }
  }, [isDemo]);

  const scheduleAutosave = useCallback((text: string) => {
    setStatus('unsaved');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(text), 1000);
  }, [save]);

  const handleEditorUpdate = useCallback((markdown: string) => {
    latestContentRef.current = markdown;
    scheduleAutosave(markdown);
  }, [scheduleAutosave]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-base font-bold text-foreground flex items-center gap-2">
          <StickyNote className="h-5 w-5 text-yellow-600 dark:text-yellow-400" aria-hidden="true" />
          Scratchpad
        </span>
        {status !== 'idle' && (
          <span className={`text-xs font-medium ${STATUS_COLOR[status]}`}>
            {STATUS_LABEL[status]}
          </span>
        )}
      </div>
      <TiptapEditor
        ref={editorRef}
        content={content}
        onUpdate={handleEditorUpdate}
        placeholder="Jot down anything — persists across days..."
      />
    </div>
  );
}
