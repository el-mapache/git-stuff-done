import { GITHUB_ORG } from './constants';
import { Octokit } from '@octokit/rest';
import { execSync } from 'child_process';
import { readConfig } from './files';

// --- Token retrieval (cached per process) ---

let cachedToken: string | null = null;

export async function getGitHubToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  try {
    cachedToken = execSync('gh auth token', { encoding: 'utf-8' }).trim();
  } catch {
    throw new Error(
      'Failed to retrieve GitHub token. Ensure `gh` CLI is installed and authenticated.',
    );
  }
  if (!cachedToken) {
    throw new Error('gh auth token returned an empty string.');
  }
  return cachedToken;
}

// --- Octokit client ---

let cachedOctokit: Octokit | null = null;

export async function getOctokit(): Promise<Octokit> {
  if (cachedOctokit) return cachedOctokit;
  const token = await getGitHubToken();
  cachedOctokit = new Octokit({ auth: token });
  return cachedOctokit;
}

// --- Issue / PR detail fetching ---

export type GitHubLinkInfo = {
  url: string;
  owner: string;
  repo: string;
  number: number;
  type: 'issue' | 'pull';
  title: string;
  state: string;
  labels: string[];
};

const GITHUB_URL_RE =
  /https:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/;

const GITHUB_URL_RE_GLOBAL =
  /https:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/g;

export function parseGitHubUrl(
  url: string,
): { owner: string; repo: string; number: number; type: 'issue' | 'pull' } | null {
  const match = url.match(GITHUB_URL_RE);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    type: match[3] === 'pull' ? 'pull' : 'issue',
    number: parseInt(match[4], 10),
  };
}

export async function fetchLinkInfo(
  url: string,
): Promise<GitHubLinkInfo | null> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) return null;

  const octokit = await getOctokit();
  const { owner, repo, number, type } = parsed;

  try {
    if (type === 'pull') {
      const { data } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: number,
      });
      return {
        url,
        owner,
        repo,
        number,
        type,
        title: data.title,
        state: data.state,
        labels: data.labels.map((l) =>
          typeof l === 'string' ? l : l.name ?? '',
        ),
      };
    }

    const { data } = await octokit.issues.get({ owner, repo, issue_number: number });
    return {
      url,
      owner,
      repo,
      number,
      type,
      title: data.title,
      state: data.state,
      labels: data.labels.map((l) =>
        typeof l === 'string' ? l : l.name ?? '',
      ),
    };
  } catch {
    return null;
  }
}

export async function extractGitHubUrls(markdown: string): Promise<string[]> {
  const matches = markdown.match(GITHUB_URL_RE_GLOBAL);
  if (!matches) return [];
  const config = await readConfig();
  return Array.from(new Set(matches)).filter((url) => {
    const parsed = parseGitHubUrl(url);
    return parsed && parsed.owner === GITHUB_ORG && !config.ignoredRepos.includes(parsed.repo);
  });
}

// --- Notifications ---

export type GitHubNotification = {
  id: string;
  reason: string;
  title: string;
  url: string;
  repoFullName: string;
  type: string;
  updatedAt: string;
  unread: boolean;
};

export async function fetchNotifications(
  options?: { participating?: boolean },
): Promise<GitHubNotification[]> {
  const octokit = await getOctokit();
  const participating = options?.participating ?? true;
  const config = await readConfig();

  const { data } = await octokit.activity.listNotificationsForAuthenticatedUser({
    participating,
  });

  const filtered = data
    .filter((n) => n.repository.owner.login === GITHUB_ORG)
    .filter((n) => !config.ignoredRepos.includes(n.repository.name))
    .filter((n) => n.subject.type === 'Issue' || n.subject.type === 'PullRequest');

  // Fetch subject state to filter to open items only
  const withState = await Promise.all(
    filtered.map(async (n) => {
      if (!n.subject.url) return null;
      try {
        const { data: subject } = await octokit.request('GET {url}', { url: n.subject.url });
        const state = (subject as { state?: string }).state;
        if (state && state !== 'open') return null;
      } catch {
        // If we can't fetch state, include it anyway
      }
      return {
        id: n.id,
        reason: n.reason,
        title: n.subject.title,
        url: n.subject.url ?? '',
        repoFullName: n.repository.full_name,
        type: n.subject.type,
        updatedAt: n.updated_at,
        unread: n.unread,
      };
    }),
  );

  return withState.filter((n): n is GitHubNotification => n !== null);
}
