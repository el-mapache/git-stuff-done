'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved';

import { DEMO_LOG_CONTENT, DEMO_RICH_LOG_CONTENT } from '@/lib/demo';

interface RawWorkLogProps {
  date?: string;
  isDemo?: boolean;
}

function getTodayLocal(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

export default function RawWorkLog({ date, isDemo = false }: RawWorkLogProps) {
  const currentDate = date ?? getTodayLocal();
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [enriching, setEnriching] = useState(false);
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
        setStatus('idle');
      }
    }
    fetchLog();
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
  }, [currentDate]);

  const handleEnrich = async () => {
    setEnriching(true);

    if (isDemo) {
      setTimeout(() => {
        setContent(DEMO_RICH_LOG_CONTENT);
        latestContentRef.current = DEMO_RICH_LOG_CONTENT;
        setEnriching(false);
      }, 1500);
      return;
    }

    // Save first, then enrich
    await save(latestContentRef.current);
    try {
      const res = await fetch('/api/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: currentDate }),
      });
      const data = await res.json();
      if (data.success && data.content) {
        setContent(data.content);
        latestContentRef.current = data.content;
        setStatus('saved');
      }
    } finally {
      setEnriching(false);
    }
  };

  const scheduleAutosave = useCallback((text: string) => {
    setStatus('unsaved');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(text), 1000);
  }, [save]);

  const updateContent = useCallback((text: string) => {
    setContent(text);
    latestContentRef.current = text;
    scheduleAutosave(text);
  }, [scheduleAutosave]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateContent(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart, selectionEnd, value } = ta;

    if (e.key === 'Tab') {
      e.preventDefault();
      if (selectionStart === selectionEnd) {
        const before = value.slice(0, selectionStart);
        const after = value.slice(selectionEnd);
        const newVal = e.shiftKey
          ? (() => {
              const lineStart = before.lastIndexOf('\n') + 1;
              const line = value.slice(lineStart);
              if (line.startsWith('  ')) {
                return value.slice(0, lineStart) + line.slice(2);
              }
              return value;
            })()
          : before + '  ' + after;
        updateContent(newVal);
        requestAnimationFrame(() => {
          const offset = e.shiftKey ? -2 : 2;
          const pos = Math.max(0, selectionStart + offset);
          ta.selectionStart = ta.selectionEnd = pos;
        });
      } else {
        const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
        const lineEnd = value.indexOf('\n', selectionEnd);
        const end = lineEnd === -1 ? value.length : lineEnd;
        const block = value.slice(lineStart, end);
        const indented = e.shiftKey
          ? block.replace(/^  /gm, '')
          : block.replace(/^/gm, '  ');
        const newVal = value.slice(0, lineStart) + indented + value.slice(end);
        updateContent(newVal);
        requestAnimationFrame(() => {
          ta.selectionStart = lineStart;
          ta.selectionEnd = lineStart + indented.length;
        });
      }
      return;
    }

    if (e.key === 'Enter') {
      const before = value.slice(0, selectionStart);
      const currentLine = before.slice(before.lastIndexOf('\n') + 1);
      const bulletMatch = currentLine.match(/^(\s*)([-*+]|\d+\.)\s/);
      if (bulletMatch) {
        const contentAfterBullet = currentLine.slice(bulletMatch[0].length);
        if (!contentAfterBullet.trim()) {
          e.preventDefault();
          const lineStart = before.lastIndexOf('\n') + 1;
          const newVal = value.slice(0, lineStart) + '\n' + value.slice(selectionEnd);
          updateContent(newVal);
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = lineStart + 1;
          });
          return;
        }
        e.preventDefault();
        const indent = bulletMatch[1];
        const bullet = bulletMatch[2];
        const nextBullet = /^\d+\.?$/.test(bullet)
          ? `${parseInt(bullet) + 1}.`
          : bullet;
        const continuation = `\n${indent}${nextBullet} `;
        const newVal = before + continuation + value.slice(selectionEnd);
        updateContent(newVal);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = selectionStart + continuation.length;
        });
      }
    }
  };

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const statusLabel: Record<SaveStatus, string> = {
    idle: '', unsaved: 'Unsaved changes', saving: 'Saving...', saved: 'Saved ✓',
  };
  const statusColor: Record<SaveStatus, string> = {
    idle: 'text-muted-foreground', unsaved: 'text-amber-500', saving: 'text-primary', saved: 'text-emerald-500',
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-sm font-semibold text-primary">
          📝 {currentDate}
        </span>
        <div className="flex items-center gap-2">
          {status !== 'idle' && (
            <span className={`text-xs font-medium ${statusColor[status]}`}>
              {statusLabel[status]}
            </span>
          )}
          <button
            onClick={() => setViewMode(viewMode === 'edit' ? 'preview' : 'edit')}
            className="rounded-lg bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground transition hover:opacity-80"
          >
            {viewMode === 'edit' ? '👁️ Preview' : '✏️ Edit'}
          </button>
          <button
            onClick={handleEnrich}
            disabled={enriching || !content.trim()}
            title={isDemo ? 'Enrich with AI (Demo)' : 'Enrich with AI'}
            className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground transition hover:opacity-80 disabled:opacity-40"
          >
            {enriching ? '🪄 Enriching…' : '🪄 Enrich'}
          </button>
        </div>
      </div>
      {viewMode === 'edit' ? (
        <textarea
          ref={textareaRef}
          className="flex-1 w-full resize-none bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground placeholder-muted-foreground focus:outline-none"
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={"- Start typing your work log...\n  - Tab indents bullets\n  - Enter auto-continues bullets"}
          spellCheck={false}
        />
      ) : (
        <div className="flex-1 w-full overflow-auto p-4 text-sm text-foreground">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({children}) => <h1 className="text-xl font-bold mt-4 mb-2 text-primary">{children}</h1>,
              h2: ({children}) => <h2 className="text-lg font-bold mt-3 mb-2 text-primary/90">{children}</h2>,
              h3: ({children}) => <h3 className="text-base font-bold mt-2 mb-1 text-primary/80">{children}</h3>,
              p: ({children}) => <p className="mb-2 leading-relaxed">{children}</p>,
              ul: ({children}) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
              ol: ({children}) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
              li: ({children}) => <li className="pl-1 marker:text-muted-foreground">{children}</li>,
              a: ({href, children}) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-foreground underline decoration-accent-foreground/30 hover:decoration-accent-foreground transition-colors">{children}</a>,
              blockquote: ({children}) => <blockquote className="border-l-4 border-muted pl-4 italic text-muted-foreground my-2">{children}</blockquote>,
              code: ({children}) => <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono text-foreground">{children}</code>,
              pre: ({children}) => <pre className="bg-muted p-2 rounded-lg overflow-x-auto my-2 text-xs text-foreground">{children}</pre>,
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
