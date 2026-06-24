'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, StickyNote } from 'lucide-react';
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
  const [linkifying, setLinkifying] = useState(false);
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

  const handleLinkify = useCallback(async () => {
    if (isDemo || !latestContentRef.current.trim()) return;

    setLinkifying(true);
    try {
      await save(latestContentRef.current);
      const res = await fetch('/api/scratchpad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'linkify' }),
      });
      const data = await res.json();
      if (data.success && typeof data.content === 'string') {
        setContent(data.content);
        latestContentRef.current = data.content;
        setStatus('saved');
      }
    } catch {
      setStatus('unsaved');
    } finally {
      setLinkifying(false);
    }
  }, [isDemo, save]);

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
        <div className="flex items-center gap-2">
          {status !== 'idle' && (
            <span className={`text-xs font-medium ${STATUS_COLOR[status]}`}>
              {STATUS_LABEL[status]}
            </span>
          )}
          <button
            onClick={handleLinkify}
            disabled={linkifying || !latestContentRef.current.trim() || isDemo}
            title="Resolve GitHub and Slack links to richer markdown links"
            className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground transition hover:opacity-80 disabled:opacity-40"
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            {linkifying ? 'Linkifying…' : 'Linkify'}
          </button>
        </div>
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
