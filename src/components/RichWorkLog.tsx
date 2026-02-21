'use client';

import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface RichWorkLogProps {
  date?: string;
}

function getTodayLocal(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function RichWorkLog({ date }: RichWorkLogProps) {
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
  }, [fetchRichLog]);

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
    <div className="flex h-full flex-col rounded-lg border border-zinc-700 bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-2">
        <span className="text-sm font-medium text-zinc-300">
          ✨ Enriched Work Log
        </span>
        <div className="flex items-center gap-2">
          {enriching && (
            <span className="text-xs text-blue-400">Enriching…</span>
          )}
          {!enriching && lastEnriched && (
            <span className="text-xs text-zinc-500">
              Last enriched {lastEnriched}
            </span>
          )}
          <button
            onClick={handleEnrich}
            disabled={enriching}
            className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {enriching ? 'Enriching…' : 'Enrich'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : !content.trim() ? (
          <p className="text-sm text-zinc-500 italic">
            No enriched log yet — click Enrich to generate
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
          color: #d4d4d8;
          font-size: 0.875rem;
          line-height: 1.625;
        }
        .prose-rich-log h1 {
          font-size: 1.5rem;
          font-weight: 700;
          color: #f4f4f5;
          margin-top: 1.25rem;
          margin-bottom: 0.5rem;
        }
        .prose-rich-log h2 {
          font-size: 1.25rem;
          font-weight: 600;
          color: #f4f4f5;
          margin-top: 1rem;
          margin-bottom: 0.5rem;
        }
        .prose-rich-log h3 {
          font-size: 1.1rem;
          font-weight: 600;
          color: #e4e4e7;
          margin-top: 0.75rem;
          margin-bottom: 0.25rem;
        }
        .prose-rich-log p {
          margin-bottom: 0.5rem;
        }
        .prose-rich-log a {
          color: #60a5fa;
          text-decoration: underline;
        }
        .prose-rich-log a:hover {
          color: #93bbfd;
        }
        .prose-rich-log code {
          background: #27272a;
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          font-size: 0.8125rem;
        }
        .prose-rich-log pre {
          background: #18181b;
          border: 1px solid #3f3f46;
          border-radius: 0.375rem;
          padding: 0.75rem;
          overflow-x: auto;
          margin-bottom: 0.75rem;
        }
        .prose-rich-log pre code {
          background: none;
          padding: 0;
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
          border-left: 3px solid #3f3f46;
          padding-left: 0.75rem;
          color: #a1a1aa;
          margin-bottom: 0.5rem;
        }
        .prose-rich-log table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 0.75rem;
        }
        .prose-rich-log th,
        .prose-rich-log td {
          border: 1px solid #3f3f46;
          padding: 0.375rem 0.625rem;
          text-align: left;
        }
        .prose-rich-log th {
          background: #27272a;
          font-weight: 600;
          color: #e4e4e7;
        }
        .prose-rich-log hr {
          border-color: #3f3f46;
          margin: 0.75rem 0;
        }
      `}</style>
    </div>
  );
}
