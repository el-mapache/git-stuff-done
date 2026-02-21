'use client';

import { useCallback, useEffect, useState } from 'react';

type Notification = {
  id: string;
  reason: string;
  title: string;
  url: string;
  repoFullName: string;
  type: string;
  updatedAt: string;
  unread: boolean;
};

function timeAgo(dateString: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateString).getTime()) / 1000,
  );
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const reasonColors: Record<string, string> = {
  review_requested: 'bg-purple-500/20 text-purple-300',
  mention: 'bg-blue-500/20 text-blue-300',
  assign: 'bg-green-500/20 text-green-300',
  subscribed: 'bg-gray-500/20 text-gray-400',
  author: 'bg-yellow-500/20 text-yellow-300',
  ci_activity: 'bg-orange-500/20 text-orange-300',
};

function reasonBadge(reason: string) {
  const colors = reasonColors[reason] ?? 'bg-gray-500/20 text-gray-400';
  const label = reason.replace(/_/g, ' ');
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors}`}
    >
      {label}
    </span>
  );
}

function notificationUrl(n: Notification): string {
  // The API URL looks like https://api.github.com/repos/owner/repo/pulls/123
  // Convert to the web URL
  const match = n.url.match(
    /repos\/([^/]+\/[^/]+)\/(pulls|issues|commits)\/(.+)/,
  );
  if (match) {
    const typeMap: Record<string, string> = {
      pulls: 'pull',
      issues: 'issues',
      commits: 'commit',
    };
    return `https://github.com/${match[1]}/${typeMap[match[2]] ?? match[2]}/${match[3]}`;
  }
  return `https://github.com/${n.repoFullName}`;
}

export default function GitHubNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications');
      const data: Notification[] = await res.json();
      setNotifications(data);
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="flex h-full flex-col rounded-xl border border-white/10 bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide">
          GitHub Notifications
        </h2>
        <button
          onClick={refresh}
          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-200"
          aria-label="Refresh notifications"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            Loading…
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            No notifications
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {notifications.map((n) => (
              <li
                key={n.id}
                className="px-4 py-3 transition-colors hover:bg-white/5"
              >
                <div className="flex items-start justify-between gap-2">
                  <a
                    href={notificationUrl(n)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 text-sm font-medium text-gray-100 hover:text-blue-400"
                  >
                    {n.unread && (
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-blue-500" />
                    )}
                    {n.title}
                  </a>
                  <span className="shrink-0 text-xs text-gray-500">
                    {timeAgo(n.updatedAt)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="truncate text-xs text-gray-500">
                    {n.repoFullName}
                  </span>
                  {reasonBadge(n.reason)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
