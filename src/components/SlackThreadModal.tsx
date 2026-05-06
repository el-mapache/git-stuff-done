'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';
import { useModels } from '@/hooks/useModels';
import MarkdownViewer from '@/components/MarkdownViewer';
import { DEMO_SLACK_SUMMARY } from '@/lib/demo';

interface SlackThreadModalProps {
  isOpen: boolean;
  onClose: () => void;
  url: string;
  onInsert: (text: string) => void;
  isDemo?: boolean;
}

type SummaryStep = 'idle' | 'loading' | 'done' | 'error';

export default function SlackThreadModal({ isOpen, onClose, url, onInsert, isDemo = false }: SlackThreadModalProps) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Summary state
  const [view, setView] = useState<'thread' | 'summary'>('thread');
  const [summaryStep, setSummaryStep] = useState<SummaryStep>('idle');
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [overridePrompt, setOverridePrompt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const { models, loading: modelsLoading } = useModels(view === 'summary');

  // Set default model once models load
  useEffect(() => {
    if (models.length > 0 && !selectedModel) {
      setSelectedModel(models[0].id);
    }
  }, [models, selectedModel]);

  // Create a read-only Tiptap editor to render the thread markdown as rich text
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: true,
        autolink: true,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({
        tightLists: true,
        linkify: true,
      }),
    ],
    content: '',
  });

  useEffect(() => {
    if (!isOpen || !url) return;
    let cancelled = false;
    setMarkdown(null);
    setError(null);
    setLoading(true);

    fetch(`/api/slack?url=${encodeURIComponent(url)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
        } else {
          const md = data.markdown ?? '';
          setMarkdown(md);
          if (editor) {
            editor.commands.setContent(md);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to fetch Slack thread.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [isOpen, url, editor]);

  // Reset summary state when modal closes or URL changes
  useEffect(() => {
    if (!isOpen) {
      setView('thread');
      setSummaryStep('idle');
      setSummary(null);
      setSummaryError(null);
      setShowFeedback(false);
      setFeedback('');
      setCustomInstructions('');
      setOverridePrompt(false);
      setSaving(false);
      setSaveMessage(null);
    }
  }, [isOpen]);

  useEffect(() => {
    setView('thread');
    setSummaryStep('idle');
    setSummary(null);
    setSummaryError(null);
    setShowFeedback(false);
    setFeedback('');
    setCustomInstructions('');
    setOverridePrompt(false);
    setSaving(false);
    setSaveMessage(null);
  }, [url]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const handleInsert = () => {
    if (markdown) {
      onInsert(markdown);
      onClose();
    }
  };

  const handleGenerate = useCallback(async (previousSummary?: string, userFeedback?: string) => {
    if (!markdown) return;

    setSummaryStep('loading');
    setSummaryError(null);

    if (isDemo) {
      setTimeout(() => {
        setSummary(DEMO_SLACK_SUMMARY);
        setSummaryStep('done');
        setShowFeedback(false);
        setFeedback('');
      }, 1200);
      return;
    }

    try {
      const res = await fetch('/api/slack/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown,
          model: selectedModel,
          ...(customInstructions.trim() ? { customInstructions: customInstructions.trim(), overridePrompt } : {}),
          ...(previousSummary ? { previousSummary } : {}),
          ...(userFeedback ? { feedback: userFeedback } : {}),
        }),
      });
      const data = await res.json();
      if (data.error) {
        setSummaryError(data.error);
        setSummaryStep('error');
      } else {
        setSummary(data.summary ?? '');
        setSummaryStep('done');
        setShowFeedback(false);
        setFeedback('');
      }
    } catch {
      setSummaryError('Failed to generate summary.');
      setSummaryStep('error');
    }
  }, [markdown, selectedModel, customInstructions, overridePrompt, isDemo]);

  const handleTryAgain = () => {
    handleGenerate(summary ?? undefined, feedback);
  };

  const todaySlug = () =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

  const handleCopy = () => {
    if (summary) navigator.clipboard.writeText(summary);
  };

  const handleDownload = () => {
    if (!summary) return;
    const blob = new Blob([summary], { type: 'text/markdown' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `slack-thread-summary-${todaySlug()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  };

  const handleSaveToRepo = async () => {
    if (!summary) return;
    if (isDemo) {
      setSaveMessage(`summaries/${todaySlug()}-slack-thread-summary.md`);
      return;
    }
    setSaving(true);
    setSummaryError(null);
    try {
      const filename = `${todaySlug()}-slack-thread-summary.md`;
      const res = await fetch('/api/summary/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content: summary }),
      });
      if (!res.ok) throw new Error('Failed to save');
      const data = await res.json();
      const msg = data.committed ? 'Saved and committed!' : 'Saved to disk.';
      setSaveMessage(`${msg} summaries/${filename}`);
    } catch {
      setSummaryError('Failed to save summary to repository.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const SlackIcon = () => (
    <svg className="shrink-0 text-muted-foreground" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
    </svg>
  );

  const CloseButton = () => (
    <button
      onClick={onClose}
      className="shrink-0 rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      aria-label="Close"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </button>
  );

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      style={{ zIndex: 9999 }}
      onMouseDown={(e) => {
        if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="bg-card border border-border rounded-lg shadow-xl flex flex-col w-full max-w-2xl max-h-[80vh]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {view === 'thread' ? (
          <>
            {/* Thread header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <SlackIcon />
                <span className="text-sm font-medium truncate text-foreground">Slack Thread</span>
                <span className="text-xs text-muted-foreground truncate hidden sm:block">{url}</span>
              </div>
              <CloseButton />
            </div>

            {/* Thread body */}
            <div className="flex-1 overflow-auto p-4">
              {loading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                  Fetching thread…
                </div>
              )}
              {error && (
                <div className="text-sm text-destructive whitespace-pre-wrap font-mono bg-destructive/10 rounded p-3">
                  {error}
                </div>
              )}
              {markdown !== null && !loading && editor && (
                <EditorContent
                  editor={editor}
                  className="tiptap-editor prose prose-sm dark:prose-invert max-w-none"
                />
              )}
            </div>

            {/* Thread footer */}
            {markdown !== null && !loading && !error && (
              <div className="flex justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-sm rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setView('summary')}
                  title={isDemo ? 'AI features are disabled in demo mode' : 'Summarize with AI'}
                  disabled={isDemo}
                  className="px-3 py-1.5 text-sm rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                  </svg>
                  Summarize
                </button>
                <button
                  onClick={handleInsert}
                  className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
                >
                  Insert into log
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Summary header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setView('thread'); setSummaryStep('idle'); setSummary(null); setSummaryError(null); setShowFeedback(false); setFeedback(''); }}
                  className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label="Back to thread"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 12H5M12 5l-7 7 7 7"/>
                  </svg>
                </button>
                <SlackIcon />
                <span className="text-sm font-medium text-foreground">Thread Summary</span>
              </div>
              <CloseButton />
            </div>

            {/* Summary body */}
            <div className="flex-1 overflow-auto">
              {summaryStep === 'idle' && (
                <div className="p-4 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                      AI Model
                    </label>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      disabled={modelsLoading || summaryStep !== 'idle'}
                      className="w-full rounded border border-input bg-muted/50 px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {modelsLoading && <option value="">Loading models…</option>}
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                      Instructions <span className="normal-case font-normal">(optional)</span>
                    </label>
                    <textarea
                      value={customInstructions}
                      onChange={(e) => setCustomInstructions(e.target.value)}
                      placeholder="e.g. focus on action items, summarize in Spanish, be very brief…"
                      className="w-full h-16 rounded border border-input bg-muted/50 px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20 resize-none transition-all"
                    />
                    <label className="flex items-center gap-2 mt-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={overridePrompt}
                        onChange={(e) => setOverridePrompt(e.target.checked)}
                        className="rounded border-input accent-primary"
                      />
                      <span className="text-xs text-muted-foreground">Replace default prompt</span>
                    </label>
                  </div>
                </div>
              )}

              {summaryStep === 'loading' && (
                <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
                  <svg className="animate-spin shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                  Generating summary…
                </div>
              )}

              {summaryStep === 'done' && summary !== null && (
                <div>
                  <div className="p-4">
                    <MarkdownViewer
                      content={summary}
                      className="prose prose-sm dark:prose-invert max-w-none"
                    />
                  </div>
                  {saveMessage && (
                    <div className="mx-4 mb-3 text-xs text-muted-foreground bg-muted rounded px-3 py-2">
                      {saveMessage}
                    </div>
                  )}
                  {showFeedback && (
                    <div className="px-4 pb-4 space-y-2 border-t border-border pt-3">
                      <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        What should be different?
                      </label>
                      <textarea
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        placeholder="e.g. Make it shorter, focus on action items, use bullet points…"
                        className="w-full h-20 rounded border border-input bg-muted/50 px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20 resize-none transition-all"
                        autoFocus
                      />
                    </div>
                  )}
                </div>
              )}

              {summaryStep === 'error' && (
                <div className="p-4">
                  <div className="text-sm text-destructive bg-destructive/10 rounded p-3">
                    {summaryError ?? 'Failed to generate summary.'}
                  </div>
                </div>
              )}
            </div>

            {/* Summary footer */}
            {summaryStep === 'idle' && (
              <div className="flex justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
                <button
                  onClick={() => setView('thread')}
                  className="px-3 py-1.5 text-sm rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => handleGenerate()}
                  disabled={!selectedModel || modelsLoading}
                  className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Generate Summary
                </button>
              </div>
            )}

            {summaryStep === 'done' && !showFeedback && (
              <div className="flex justify-between items-center gap-2 px-4 py-3 border-t border-border shrink-0">
                <div className="flex gap-2">
                  <button
                    onClick={handleCopy}
                    className="px-3 py-1.5 text-sm rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    Copy
                  </button>
                  <button
                    onClick={handleDownload}
                    className="px-3 py-1.5 text-sm rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    Download .md
                  </button>
                  <button
                    onClick={handleSaveToRepo}
                    disabled={saving}
                    className="px-3 py-1.5 text-sm rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Committing…' : 'Save & Commit'}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowFeedback(true)}
                    className="px-3 py-1.5 text-sm rounded border border-border text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 4v6h6M23 20v-6h-6"/>
                      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                    </svg>
                    Reject
                  </button>
                  <button
                    onClick={() => { onInsert(summary!); onClose(); }}
                    className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
                  >
                    Accept &amp; Insert
                  </button>
                </div>
              </div>
            )}

            {summaryStep === 'done' && showFeedback && (
              <div className="flex justify-between items-center gap-2 px-4 py-3 border-t border-border shrink-0">
                <div className="flex gap-2">
                  <button
                    onClick={handleCopy}
                    className="px-3 py-1.5 text-sm rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    Copy
                  </button>
                  <button
                    onClick={handleDownload}
                    className="px-3 py-1.5 text-sm rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    Download .md
                  </button>
                  <button
                    onClick={handleSaveToRepo}
                    disabled={saving}
                    className="px-3 py-1.5 text-sm rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Committing…' : 'Save & Commit'}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowFeedback(false); setFeedback(''); }}
                    className="px-3 py-1.5 text-sm rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleTryAgain}
                    disabled={!feedback.trim()}
                    className="px-3 py-1.5 text-sm rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Try Again
                  </button>
                  <button
                    onClick={() => { onInsert(summary!); onClose(); }}
                    className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
                  >
                    Accept &amp; Insert
                  </button>
                </div>
              </div>
            )}

            {summaryStep === 'error' && (
              <div className="flex justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
                <button
                  onClick={() => { setView('thread'); setSummaryStep('idle'); setSummaryError(null); }}
                  className="px-3 py-1.5 text-sm rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => handleGenerate()}
                  className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
                >
                  Retry
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

