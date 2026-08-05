'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileText, Link2, Sparkles } from 'lucide-react';
import TiptapEditor, { type TiptapEditorHandle } from './TiptapEditor';
import { DEMO_LOG_CONTENT, DEMO_RICH_LOG_CONTENT } from '@/lib/demo';
import SlackThreadModal from './SlackThreadModal';
import { PLACEHOLDER_PREFIX } from '@/lib/customImage';
import { upsertBlock } from '@/lib/managedBlock';
import { DAILY_ACTIVITY_KEY } from '@/lib/constants';


type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved';

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: '', unsaved: 'Unsaved changes', saving: 'Saving...', saved: 'Saved ✓',
};
const STATUS_COLOR: Record<SaveStatus, string> = {
  idle: 'text-muted-foreground', unsaved: 'text-amber-500', saving: 'text-primary', saved: 'text-emerald-500',
};

interface RawWorkLogProps {
  date?: string;
  isDemo?: boolean;
  onRegisterInsert?: (fn: (text: string) => void) => void;
}

function getTodayLocal(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

export default function RawWorkLog({ date, isDemo = false, onRegisterInsert }: RawWorkLogProps) {
  const currentDate = date ?? getTodayLocal();
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [linkifying, setLinkifying] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [slackModalUrl, setSlackModalUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef(content);
  const currentDateRef = useRef(currentDate);
  const editorRef = useRef<TiptapEditorHandle>(null);

  useEffect(() => {
    currentDateRef.current = currentDate;
  }, [currentDate]);

  useEffect(() => {
    let cancelled = false;
    async function fetchLog() {
      if (isDemo) {
        setContent(DEMO_LOG_CONTENT);
        latestContentRef.current = DEMO_LOG_CONTENT;
        setStatus('idle');
        return;
      }
      const res = await fetch(`/api/log?date=${currentDate}`);
      const data = await res.json();
      if (!cancelled) {
        setContent(data.content);
        latestContentRef.current = data.content;
        setHasContent(!!data.content.trim());
        setStatus('idle');
      }
    }
    fetchLog();
    // Preload org members cache so @mention search is instant
    if (!isDemo) fetch('/api/org-members?preload=1').catch(() => {});
    return () => { cancelled = true; };
  }, [currentDate, isDemo]);

  const save = useCallback(async (text: string) => {
    if (isDemo) return;
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
  }, [currentDate, isDemo]);

  const handleLinkify = async () => {
    setLinkifying(true);

    if (isDemo) {
      setTimeout(() => {
        setContent(DEMO_RICH_LOG_CONTENT);
        latestContentRef.current = DEMO_RICH_LOG_CONTENT;
        setLinkifying(false);
      }, 1500);
      return;
    }

    // Save first, then linkify
    await save(latestContentRef.current);
    try {
      const res = await fetch('/api/linkify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: currentDate }),
      });
      const data = await res.json();
      if (data.success && data.content) {
        setContent(data.content);
        latestContentRef.current = data.content;
        setHasContent(!!data.content.trim());
        setStatus('saved');
      }
    } finally {
      setLinkifying(false);
    }
  };

  const handleGenerateActivity = async () => {
    if (isDemo) return;
    const requestDate = currentDate;
    setGenerating(true);
    try {
      // Persist current edits first so we merge into the latest content.
      await save(latestContentRef.current);
      const res = await fetch('/api/daily-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: requestDate }),
      });
      const data = await res.json();
      // The server already wrote+committed the block for requestDate. If the
      // user navigated to a different day while this (up to ~5 min) request
      // was in flight, applying the merge here would write the wrong day's
      // content, so skip the client-side merge/save in that case. Read from
      // a ref (not the closure-local currentDate, which is frozen at the
      // value from click time) so navigation during the await is detected.
      if (currentDateRef.current !== requestDate) return;
      if (data.success && data.section) {
        // Cancel any pending debounced autosave so it can't land after (and
        // silently overwrite) the merge-save below with stale pre-merge text.
        if (timerRef.current) clearTimeout(timerRef.current);
        const merged = upsertBlock(latestContentRef.current, DAILY_ACTIVITY_KEY, data.section);
        setContent(merged);
        latestContentRef.current = merged;
        setHasContent(!!merged.trim());
        await save(merged);
      } else {
        handleUploadError(data.error || 'Failed to generate daily activity');
      }
    } catch {
      handleUploadError('Failed to generate daily activity');
    } finally {
      setGenerating(false);
    }
  };

  const scheduleAutosave = useCallback((text: string) => {
    setStatus('unsaved');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(text), 1000);
  }, [save]);

  const handleEditorUpdate = useCallback((markdown: string) => {
    latestContentRef.current = markdown;
    setHasContent(!!markdown.trim());
    // Pause auto-save while any image upload placeholder is in the document
    if (!markdown.includes(PLACEHOLDER_PREFIX)) {
      scheduleAutosave(markdown);
    }
  }, [scheduleAutosave]);

  const handleImageUpload = useCallback(async (file: File): Promise<string> => {
    if (isDemo) throw new Error('Upload disabled in demo mode');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('date', currentDate);
    const res = await fetch('/api/attachments', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data.url;
  }, [currentDate, isDemo]);

  const handleDeleteImage = useCallback(async (url: string) => {
    if (isDemo) return;
    try {
      await fetch(url, { method: 'DELETE' });
    } catch { /* ignore */ }
  }, [isDemo]);

  const handleUploadError = useCallback((msg: string) => {
    setUploadError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setUploadError(null), 4000);
  }, []);

  const insertAtCursor = useCallback((text: string) => {
    editorRef.current?.insertAtCursor(text);
  }, []);

  useEffect(() => {
    onRegisterInsert?.(insertAtCursor);
  }, [onRegisterInsert, insertAtCursor]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-base font-bold text-foreground flex items-center gap-2">
          <FileText className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          {currentDate}
        </span>
        <div className="flex items-center gap-2">
          {status !== 'idle' && (
            <span className={`text-xs font-medium ${STATUS_COLOR[status]}`}>
              {STATUS_LABEL[status]}
            </span>
          )}
          <button
            onClick={handleGenerateActivity}
            disabled={generating || isDemo}
            title={isDemo ? 'Disabled in demo mode' : 'Generate today\u2019s GitHub + Slack activity summary'}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground transition hover:opacity-80 disabled:opacity-40"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {generating ? 'Generating…' : 'Daily activity'}
          </button>
          <button
            onClick={handleLinkify}
            disabled={linkifying || !hasContent}
            title="Resolve GitHub links to their issue and PR titles"
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
        onSlackLinkClick={setSlackModalUrl}
        placeholder="Start typing your work log..."
        onImageUpload={handleImageUpload}
        onDeleteImage={handleDeleteImage}
        onUploadError={handleUploadError}
      />
      <SlackThreadModal
        isOpen={slackModalUrl !== null}
        onClose={() => setSlackModalUrl(null)}
        url={slackModalUrl ?? ''}
        onInsert={(text) => editorRef.current?.insertAtCursor(text)}
        isDemo={isDemo}
      />
      {uploadError && (
        <div className="shrink-0 border-t border-destructive/20 px-4 py-2.5 bg-destructive/10 text-destructive text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {uploadError}
        </div>
      )}
    </div>
  );
}
