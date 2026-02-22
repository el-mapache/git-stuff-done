'use client';

import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface RichWorkLogProps {
  date?: string;
  refreshKey?: number;
}

function getTodayLocal(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

export default function RichWorkLog({ date, refreshKey }: RichWorkLogProps) {
  const currentDate = date ?? getTodayLocal();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [lastEnriched, setLastEnriched] = useState<string | null>(null);

  const fetchRichLog = useCallback(async () => {
    const res = await fetch(`/api/richlog?date=${currentDate}`);
    const data = await res.json();
    setContent(data.content ?? '');
    setLoading(false);
  }, [currentDate]);

  useEffect(() => {
    setLoading(true);
    fetchRichLog();
  }, [fetchRichLog, refreshKey]);

  const handleEnrich = async () => {
    setEnriching(true);
    try {
      const res = await fetch('/api/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: currentDate }),
      });
      const data = await res.json();
      if (data.success) {
        setLastEnriched(new Date().toLocaleTimeString());
        await fetchRichLog();
      }
    } finally {
      setEnriching(false);
    }
  };

  return (
    <div className="flex h-full flex-col rounded-lg border border-zinc-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 rounded-t-lg px-3 py-2">
        <span className="text-sm font-semibold text-zinc-600">
          🪄 Enriched Work Log
        </span>
        <div className="flex items-center gap-2">
          {enriching && (
            <span className="text-xs text-violet-500 font-medium">Enriching…</span>
          )}
          {!enriching && lastEnriched && (
            <span className="text-xs text-zinc-400">
              Last enriched {lastEnriched}
            </span>
          )}
          <button
            onClick={handleEnrich}
            disabled={enriching}
            className="rounded bg-violet-500 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {enriching ? '🪄 Enriching…' : '🪄 Enrich'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 bg-white rounded-b-lg">
        {loading ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : !content.trim() ? (
          <p className="text-sm text-zinc-400 italic">
            No enriched log yet — click Enrich to generate ✨
          </p>
        ) : (
          <article className="prose-rich-log">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </article>
        )}
      </div>

      {/* Scoped markdown styles */}
      <style jsx global>{`
        .prose-rich-log {
          color: #3f3f46;
          font-size: 0.875rem;
          line-height: 1.625;
        }
        .prose-rich-log h1 {
          font-size: 1.5rem;
          font-weight: 700;
          color: #18181b;
          margin-top: 1.25rem;
          margin-bottom: 0.5rem;
        }
        .prose-rich-log h2 {
          font-size: 1.25rem;
          font-weight: 600;
          color: #18181b;
          margin-top: 1rem;
          margin-bottom: 0.5rem;
        }
        .prose-rich-log h3 {
          font-size: 1.1rem;
          font-weight: 600;
          color: #27272a;
          margin-top: 0.75rem;
          margin-bottom: 0.25rem;
        }
        .prose-rich-log p {
          margin-bottom: 0.5rem;
        }
        .prose-rich-log a {
          color: #7c3aed;
          text-decoration: underline;
        }
        .prose-rich-log a:hover {
          color: #6d28d9;
        }
        .prose-rich-log code {
          background: #f4f4f5;
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          font-size: 0.8125rem;
          color: #7c3aed;
        }
        .prose-rich-log pre {
          background: #fafafa;
          border: 1px solid #e4e4e7;
          border-radius: 0.375rem;
          padding: 0.75rem;
          overflow-x: auto;
          margin-bottom: 0.75rem;
        }
        .prose-rich-log pre code {
          background: none;
          padding: 0;
          color: #3f3f46;
        }
        .prose-rich-log ul,
        .prose-rich-log ol {
          padding-left: 1.25rem;
          margin-bottom: 0.5rem;
        }
        .prose-rich-log ul {
          list-style-type: disc;
        }
        .prose-rich-log ol {
          list-style-type: decimal;
        }
        .prose-rich-log li {
          margin-bottom: 0.125rem;
        }
        .prose-rich-log blockquote {
          border-left: 3px solid #e4e4e7;
          padding-left: 0.75rem;
          color: #71717a;
          margin-bottom: 0.5rem;
        }
        .prose-rich-log table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 0.75rem;
        }
        .prose-rich-log th,
        .prose-rich-log td {
          border: 1px solid #e4e4e7;
          padding: 0.375rem 0.625rem;
          text-align: left;
        }
        .prose-rich-log th {
          background: #f4f4f5;
          font-weight: 600;
          color: #27272a;
        }
        .prose-rich-log hr {
          border-color: #e4e4e7;
          margin: 0.75rem 0;
        }
      `}</style>
    </div>
  );
}
