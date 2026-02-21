import { Octokit } from '@octokit/rest';
import { execSync } from 'child_process';

export const GITHUB_ORG = 'github';

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

export function extractGitHubUrls(markdown: string): string[] {
  const matches = markdown.match(GITHUB_URL_RE_GLOBAL);
  if (!matches) return [];
  return Array.from(new Set(matches)).filter((url) => {
    const parsed = parseGitHubUrl(url);
    return parsed && parsed.owner === GITHUB_ORG;
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

  const { data } = await octokit.activity.listNotificationsForAuthenticatedUser({
    participating,
  });

  return data
    .filter((n) => n.repository.owner.login === GITHUB_ORG)
    .map((n) => ({
      id: n.id,
      reason: n.reason,
      title: n.subject.title,
      url: n.subject.url ?? '',
      repoFullName: n.repository.full_name,
      type: n.subject.type,
      updatedAt: n.updated_at,
      unread: n.unread,
    }));
}
