import { COPILOT_AGENT_LOGIN, GITHUB_ORG, isCopilotLogin } from "./constants";
import { Octokit } from "@octokit/rest";
import { execFileSync } from "child_process";
import { readConfig } from "./files";

// --- Token retrieval (cached per process) ---

let cachedToken: string | null = null;

export async function getGitHubToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  // Prefer explicit read-only token, then GH_TOKEN, then gh CLI
  const envToken = process.env.GITHUB_READ_TOKEN || process.env.GH_TOKEN;
  if (envToken) {
    cachedToken = envToken.trim();
    return cachedToken;
  }
  try {
    cachedToken = execFileSync("gh", ["auth", "token"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    throw new Error(
      "Failed to retrieve GitHub token. Set GITHUB_READ_TOKEN env var or ensure `gh` CLI is installed and authenticated.",
    );
  }
  if (!cachedToken) {
    throw new Error("GitHub token is empty.");
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

// Retry a Search API call once if it returns total_count: 0. GitHub Search has
// known incidents where the lexical backend returns spurious zeros; a single
// retry after a short delay materially improves reliability without making the
// genuinely-empty case much slower.
async function searchWithRetryOnZero<
  T extends { data: { total_count: number; items: unknown[] } },
>(label: string, fn: () => Promise<T>): Promise<T> {
  const first = await fn();
  if (first.data.total_count > 0) return first;
  await new Promise((r) => setTimeout(r, 500));
  const retry = await fn();
  if (retry.data.total_count > 0) {
    console.log(
      `[github] ${label}: retry returned`,
      retry.data.total_count,
      "(first was 0)",
    );
    return retry;
  }
  return first;
}

// --- Issue / PR detail fetching ---

export type GitHubLinkInfo = {
  url: string;
  owner: string;
  repo: string;
  number: number;
  type: "issue" | "pull";
  title: string;
  state: string;
  labels: string[];
};

const GITHUB_URL_RE =
  /https:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/;

const GITHUB_URL_RE_GLOBAL =
  /https:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/g;

export function parseGitHubUrl(url: string): {
  owner: string;
  repo: string;
  number: number;
  type: "issue" | "pull";
} | null {
  const match = url.match(GITHUB_URL_RE);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    type: match[3] === "pull" ? "pull" : "issue",
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
    if (type === "pull") {
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
          typeof l === "string" ? l : (l.name ?? ""),
        ),
      };
    }

    const { data } = await octokit.issues.get({
      owner,
      repo,
      issue_number: number,
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
        typeof l === "string" ? l : (l.name ?? ""),
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
    return (
      parsed &&
      parsed.owner === GITHUB_ORG &&
      !config.ignoredRepos.includes(parsed.repo)
    );
  });
}

// --- My PRs ---

export type MyPullRequest = {
  id: number;
  number: number;
  title: string;
  url: string;
  repoFullName: string;
  state: string;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  reviewDecision: string | null;
  ciStatus: "success" | "failure" | "pending" | null;
  unresolvedThreads: number;
  mergeQueueState: "queued" | "merging" | null;
  authorLogin: string;
  isAssignee: boolean;
  branchName: string;
};

export async function fetchMyPRs(): Promise<MyPullRequest[]> {
  console.log("[github] fetchMyPRs: Starting fetch");
  const octokit = await getOctokit();
  const config = await readConfig();
  const { data: userData } = await octokit.users.getAuthenticated();
  const user = userData.login;
  console.log("[github] fetchMyPRs: User =", user, "Org =", GITHUB_ORG);

  // Fetch PRs authored by and assigned to the user (two queries, deduplicated).
  // Run sequentially: GitHub's Search API silently returns 0 results when hit
  // with concurrent calls from the same token. Retry-on-zero compensates for
  // GitHub Search incidents that yield spurious empty responses.
  const authoredRes = await searchWithRetryOnZero("fetchMyPRs authored", () =>
    octokit.search.issuesAndPullRequests({
      q: `is:pr is:open author:${user} org:${GITHUB_ORG}`,
      sort: "updated",
      order: "desc",
      per_page: 30,
    }),
  );
  const assignedRes = await searchWithRetryOnZero("fetchMyPRs assigned", () =>
    octokit.search.issuesAndPullRequests({
      q: `is:pr is:open assignee:${user} org:${GITHUB_ORG}`,
      sort: "updated",
      order: "desc",
      per_page: 30,
    }),
  );
  console.log(
    "[github] fetchMyPRs: Authored =",
    authoredRes.data.items.length,
    "Assigned =",
    assignedRes.data.items.length,
  );

  // Deduplicate by ID and sort by updatedAt
  const seenIds = new Set<number>();
  const allItems = [...authoredRes.data.items, ...assignedRes.data.items]
    .filter((item) => {
      if (seenIds.has(item.id)) return false;
      seenIds.add(item.id);
      return true;
    })
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )
    .slice(0, 30);

  const prs = await Promise.all(
    allItems
      .filter((item) => {
        const repo = item.repository_url.split("/").pop() ?? "";
        return !config.ignoredRepos.includes(repo);
      })
      .map(async (item) => {
        const urlParts = item.repository_url.split("/");
        const owner = urlParts[urlParts.length - 2];
        const repo = urlParts[urlParts.length - 1];
        let additions = 0,
          deletions = 0,
          draft = false,
          branchName = "";
        try {
          const { data: pr } = await octokit.pulls.get({
            owner,
            repo,
            pull_number: item.number,
          });
          additions = pr.additions;
          deletions = pr.deletions;
          draft = pr.draft ?? false;
          branchName = pr.head?.ref ?? "";
        } catch {
          /* ignore */
        }
        return {
          id: item.id,
          number: item.number,
          title: item.title,
          url: item.html_url,
          repoFullName: `${owner}/${repo}`,
          state: item.state,
          draft,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          additions,
          deletions,
          reviewDecision: null as string | null,
          ciStatus: null as MyPullRequest["ciStatus"],
          unresolvedThreads: 0,
          mergeQueueState: null as MyPullRequest["mergeQueueState"],
          authorLogin: item.user?.login ?? "",
          isAssignee: item.assignees?.some((a) => a.login === user) ?? false,
          branchName,
        };
      }),
  );

  // Batch-fetch merge queue status via GraphQL
  try {
    const grouped = new Map<
      string,
      { owner: string; repo: string; numbers: number[] }
    >();
    for (const pr of prs) {
      const key = pr.repoFullName;
      if (!grouped.has(key)) {
        const [owner, repo] = key.split("/");
        grouped.set(key, { owner, repo, numbers: [] });
      }
      grouped.get(key)!.numbers.push(pr.number);
    }

    // Build a single GraphQL query with aliased fields
    const fragments: string[] = [];
    const prKeyMap: string[] = []; // maps alias → "owner/repo#number"
    let idx = 0;
    for (const [, { owner, repo, numbers }] of grouped) {
      for (const num of numbers) {
        const alias = `pr${idx}`;
        fragments.push(
          `${alias}: repository(owner: "${owner}", name: "${repo}") { pullRequest(number: ${num}) { number isInMergeQueue mergeQueueEntry { position state } reviewDecision commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes { __typename ... on CheckRun { conclusion isRequired(pullRequestNumber: ${num}) } ... on StatusContext { state isRequired(pullRequestNumber: ${num}) } } } } } } } reviewThreads(first: 100) { nodes { isResolved isOutdated comments(first: 100) { nodes { author { login } } } } } } }`,
        );
        prKeyMap.push(`${owner}/${repo}#${num}`);
        idx++;
      }
    }

    if (fragments.length > 0) {
      const query = `query { ${fragments.join("\n")} }`;
      type CheckContext = {
        __typename: "CheckRun" | "StatusContext";
        conclusion?: string | null;
        state?: string;
        isRequired: boolean;
      };
      type ReviewThread = {
        isResolved: boolean;
        isOutdated: boolean;
        comments: { nodes: { author: { login: string } | null }[] };
      };
      type GraphQLPR = {
        pullRequest: {
          number: number;
          isInMergeQueue: boolean;
          mergeQueueEntry: { position: number; state: string } | null;
          reviewDecision: string | null;
          commits: {
            nodes: {
              commit: {
                statusCheckRollup: {
                  contexts: { nodes: CheckContext[] };
                } | null;
              };
            }[];
          };
          reviewThreads: { nodes: ReviewThread[] };
        };
      };
      const result = await octokit.graphql<Record<string, GraphQLPR>>(query);

      // Build lookup map from GraphQL results
      const graphqlData = new Map<string, GraphQLPR["pullRequest"]>();
      for (let i = 0; i < prKeyMap.length; i++) {
        const data = result[`pr${i}`];
        if (data?.pullRequest) {
          graphqlData.set(prKeyMap[i], data.pullRequest);
        }
      }

      for (const pr of prs) {
        const gql = graphqlData.get(`${pr.repoFullName}#${pr.number}`);
        if (!gql) continue;

        if (gql.mergeQueueEntry) {
          const mqState = gql.mergeQueueEntry.state;
          pr.mergeQueueState =
            mqState === "LOCKED" || mqState === "MERGEABLE"
              ? "merging"
              : "queued";
        } else if (gql.isInMergeQueue) {
          pr.mergeQueueState = "queued";
        }
        pr.reviewDecision = gql.reviewDecision ?? null;

        // CI status — only consider required checks; fall back to all checks if none are required
        const contexts =
          gql.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ??
          [];
        if (contexts.length > 0) {
          const requiredChecks = contexts.filter((c) => c.isRequired);
          const checksToEvaluate =
            requiredChecks.length > 0 ? requiredChecks : contexts;

          const hasFailing = checksToEvaluate.some((c) => {
            if (c.__typename === "CheckRun") {
              return (
                c.conclusion === "FAILURE" ||
                c.conclusion === "TIMED_OUT" ||
                c.conclusion === "STARTUP_FAILURE"
              );
            }
            return c.state === "FAILURE" || c.state === "ERROR";
          });
          const hasPending = checksToEvaluate.some((c) => {
            if (c.__typename === "CheckRun") return c.conclusion === null;
            return c.state === "PENDING" || c.state === "EXPECTED";
          });

          if (hasFailing) pr.ciStatus = "failure";
          else if (hasPending) pr.ciStatus = "pending";
          else pr.ciStatus = "success";
        }

        // Count review threads with unanswered comments from human reviewers.
        // A thread counts only if a human reviewer (not the PR author, not a bot)
        // has commented AND the PR author hasn't replied after them.
        const isBot = (login: string) =>
          !login ||
          login.endsWith("[bot]") ||
          isCopilotLogin(login) ||
          login === "github-copilot";

        pr.unresolvedThreads = (gql.reviewThreads?.nodes ?? []).filter((t) => {
          if (t.isResolved) return false;
          if (t.isOutdated) return false;
          const comments = t.comments?.nodes ?? [];
          if (comments.length === 0) return false;

          // Check if any human reviewer (not the author, not a bot) participated
          const hasReviewerComment = comments.some((c) => {
            const login = c.author?.login ?? "";
            return !isBot(login) && login !== user;
          });
          if (!hasReviewerComment) return false;

          // Find the last non-bot comment — if it's from the author, they already replied
          const lastHumanComment = [...comments]
            .reverse()
            .find((c) => !isBot(c.author?.login ?? ""));
          if (!lastHumanComment) return false;
          return lastHumanComment.author?.login !== user;
        }).length;
      }
    }
  } catch (err) {
    console.error("[github] fetchMyPRs: GraphQL enrichment failed:", err);
  }

  return prs;
}

// --- My Issues ---

export type MyIssue = {
  id: number;
  number: number;
  title: string;
  url: string;
  repoFullName: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  labels: string[];
  commentCount: number;
  author: string;
  assignees: string[];
  linkedPRs: {
    number: number;
    title: string;
    url: string;
    state: string;
    isDraft: boolean;
    repoFullName: string;
  }[];
};

export async function fetchMyIssues(): Promise<MyIssue[]> {
  console.log("[github] fetchMyIssues: Starting fetch");
  const octokit = await getOctokit();
  const config = await readConfig();
  const { data: userData } = await octokit.users.getAuthenticated();
  const user = userData.login;
  console.log("[github] fetchMyIssues: User =", user, "Org =", GITHUB_ORG);

  const res = await searchWithRetryOnZero("fetchMyIssues", () =>
    octokit.search.issuesAndPullRequests({
      q: `is:issue is:open assignee:${user} org:${GITHUB_ORG}`,
      sort: "updated",
      order: "desc",
      per_page: 30,
    }),
  );
  console.log("[github] fetchMyIssues: Found", res.data.items.length, "issues");

  const issues: MyIssue[] = res.data.items
    .filter((item) => {
      const repo = item.repository_url.split("/").pop() ?? "";
      return !config.ignoredRepos.includes(repo);
    })
    .map((item) => {
      const urlParts = item.repository_url.split("/");
      const owner = urlParts[urlParts.length - 2];
      const repo = urlParts[urlParts.length - 1];
      return {
        id: item.id,
        number: item.number,
        title: item.title,
        url: item.html_url,
        repoFullName: `${owner}/${repo}`,
        state: item.state,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        labels: (item.labels as Array<{ name?: string }>)
          .map((l) => l.name ?? "")
          .filter(Boolean),
        commentCount: item.comments,
        author: item.user?.login ?? "",
        assignees: (item.assignees ?? []).map((a) => a.login),
        linkedPRs: [],
      };
    });

  // Batch-fetch linked PRs via GraphQL (timelineItems cross-references)
  try {
    const grouped = new Map<
      string,
      { owner: string; repo: string; numbers: number[] }
    >();
    for (const issue of issues) {
      const key = issue.repoFullName;
      if (!grouped.has(key)) {
        const [owner, repo] = key.split("/");
        grouped.set(key, { owner, repo, numbers: [] });
      }
      grouped.get(key)!.numbers.push(issue.number);
    }

    const fragments: string[] = [];
    const issueKeyMap: string[] = [];
    let idx = 0;
    for (const [, { owner, repo, numbers }] of grouped) {
      for (const num of numbers) {
        const alias = `issue${idx}`;
        fragments.push(
          `${alias}: repository(owner: "${owner}", name: "${repo}") { issue(number: ${num}) { timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], last: 10) { nodes { ... on CrossReferencedEvent { source { __typename ... on PullRequest { number title url state isDraft repository { nameWithOwner } } } } } } } }`,
        );
        issueKeyMap.push(`${owner}/${repo}#${num}`);
        idx++;
      }
    }

    if (fragments.length > 0) {
      const query = `query { ${fragments.join("\n")} }`;
      type LinkedPR = {
        number: number;
        title: string;
        url: string;
        state: string;
        isDraft: boolean;
        repository?: {
          nameWithOwner: string;
        };
      };
      type GraphQLIssue = {
        issue: {
          timelineItems: {
            nodes: {
              source?: { __typename: string } & Partial<LinkedPR>;
            }[];
          };
        };
      };
      const result = await octokit.graphql<Record<string, GraphQLIssue>>(query);

      for (let i = 0; i < issueKeyMap.length; i++) {
        const alias = `issue${i}`;
        const key = issueKeyMap[i];
        const [repoFullName, numStr] = key.split("#");
        const num = parseInt(numStr, 10);
        const issueObj = issues.find(
          (iss) => iss.repoFullName === repoFullName && iss.number === num,
        );
        if (!issueObj) continue;
        const nodes = result[alias]?.issue?.timelineItems?.nodes ?? [];
        issueObj.linkedPRs = nodes
          .filter((n) => n.source?.__typename === "PullRequest")
          .map((n) => {
            const pr = n.source as LinkedPR;
            return {
              number: pr.number,
              title: pr.title,
              url: pr.url,
              state: pr.state,
              isDraft: pr.isDraft,
              repoFullName:
                pr.repository?.nameWithOwner ?? issueObj.repoFullName,
            };
          });
      }
    }
  } catch {
    /* degrade gracefully */
  }

  return issues;
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
  prState?: 'open' | 'draft';
};

const RELEVANT_REASONS = new Set([
  "review_requested",
  "mention",
  "assign",
  "author",
  "comment",
]);

export async function fetchNotifications(options?: {
  participating?: boolean;
}): Promise<GitHubNotification[]> {
  const octokit = await getOctokit();
  const participating = options?.participating ?? true;
  const config = await readConfig();

  const { data } = await octokit.activity.listNotificationsForAuthenticatedUser(
    {
      participating,
    },
  );

  const filtered = data
    .filter((n) => n.repository.owner.login === GITHUB_ORG)
    .filter((n) => !config.ignoredRepos.includes(n.repository.name))
    .filter(
      (n) => n.subject.type === "Issue" || n.subject.type === "PullRequest",
    )
    .filter((n) => RELEVANT_REASONS.has(n.reason));

  // Fetch subject state to filter to open items only
  const withState = await Promise.all(
    filtered.map(async (n) => {
      if (!n.subject.url) return null;
      let prState: 'open' | 'draft' | undefined;
      try {
        const { data: subject } = await octokit.request("GET {url}", {
          url: n.subject.url,
        });
        const s = subject as { state?: string; draft?: boolean };
        const state = s.state;
        if (state && state !== "open") return null;
        if (n.subject.type === "PullRequest") {
          prState = s.draft ? 'draft' : 'open';
        }
      } catch {
        // If we can't fetch state, include it anyway
      }
      return {
        id: n.id,
        reason: n.reason,
        title: n.subject.title,
        url: n.subject.url ?? "",
        repoFullName: n.repository.full_name,
        type: n.subject.type,
        updatedAt: n.updated_at,
        unread: n.unread,
        ...(prState !== undefined ? { prState } : {}),
      } as GitHubNotification;
    }),
  );

  return withState.filter((n): n is GitHubNotification => n !== null);
}

// --- Org Repos ---

export type OrgRepo = {
  name: string;
  fullName: string;
};

export type OrgReposPage = {
  repos: OrgRepo[];
  hasMore: boolean;
};

export async function fetchOrgRepos(opts?: {
  page?: number;
  perPage?: number;
  query?: string;
}): Promise<OrgReposPage> {
  const octokit = await getOctokit();
  const config = await readConfig();
  const page = opts?.page ?? 1;
  const perPage = opts?.perPage ?? 30;
  const query = opts?.query?.trim();

  if (query) {
    // Strip org prefix if user types "org/repo-name"
    const searchTerm = query.includes("/") ? query.split("/").pop()! : query;

    // Use search API for type-ahead
    const { data } = await octokit.search.repos({
      q: `${searchTerm} org:${GITHUB_ORG}`,
      sort: "updated",
      order: "desc",
      per_page: perPage,
      page,
    });
    const repos = data.items
      .filter((r) => !config.ignoredRepos.includes(r.name))
      .map((r) => ({ name: r.name, fullName: r.full_name }));
    return { repos, hasMore: data.total_count > page * perPage };
  }

  const { data } = await octokit.repos.listForOrg({
    org: GITHUB_ORG,
    sort: "pushed",
    direction: "desc",
    per_page: perPage,
    page,
  });
  const repos = data
    .filter((r) => !config.ignoredRepos.includes(r.name))
    .map((r) => ({ name: r.name, fullName: r.full_name }));
  return { repos, hasMore: data.length === perPage };
}

// --- Copilot Agent Assignment ---

export type CopilotAssignResult = {
  success: boolean;
  error?: string;
};

export async function assignCopilotToIssue(opts: {
  owner: string;
  repo: string;
  issueNumber: number;
  targetRepo: string;
  model: string;
  instructions: string;
}): Promise<CopilotAssignResult> {
  const octokit = await getOctokit();
  const { data: userData } = await octokit.users.getAuthenticated();
  const user = userData.login;

  // Build custom_instructions with system-level directives prepended
  const issueRef = `${opts.owner}/${opts.repo}#${opts.issueNumber}`;
  const systemDirectives = [
    `After completing your work, comment on the original issue (${issueRef}) with a summary of the root cause and the fix you applied.`,
    `Assign the pull request you create to both yourself and @${user}.`,
  ];
  const fullInstructions = opts.instructions
    ? [...systemDirectives, "", opts.instructions].join("\n")
    : systemDirectives.join("\n");

  // Assign Copilot coding agent with agent_assignment params
  try {
    await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/assignees",
      {
        owner: opts.owner,
        repo: opts.repo,
        issue_number: opts.issueNumber,
        assignees: [COPILOT_AGENT_LOGIN],
        agent_assignment: {
          target_repo: opts.targetRepo,
          model: opts.model || "",
          custom_instructions: fullInstructions,
        },
        headers: {
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
  } catch (err) {
    const msg = (err as Error).message || "Unknown error";
    console.error(`[copilot-assign] GitHub API error: ${msg}`);
    return { success: false, error: msg };
  }

  // Assign the current user to the issue separately
  try {
    await octokit.issues.addAssignees({
      owner: opts.owner,
      repo: opts.repo,
      issue_number: opts.issueNumber,
      assignees: [user],
    });
  } catch {
    // best-effort — user may already be assigned
  }

  return { success: true };
}

// --- Daily activity (created issues/PRs + authored commits) ---

export type ActivityItem = {
  number: number;
  title: string;
  url: string;
  repoFullName: string;
};

export type CommitItem = {
  sha: string;
  shortSha: string;
  message: string;
  url: string;
  repoFullName: string;
};

export type GitHubActivity = {
  issuesCreated: ActivityItem[];
  prsCreated: ActivityItem[];
  commits: CommitItem[];
};

/** Split a comma-separated GITHUB_ORG into trimmed, non-empty org names. */
function orgList(): string[] {
  return GITHUB_ORG.split(",").map((o) => o.trim()).filter(Boolean);
}

/**
 * Gather issues created, PRs created, and commits authored by the
 * authenticated user on `date` (YYYY-MM-DD) across all configured orgs.
 * Ignored repos are filtered out. Failures in any single query are logged
 * and treated as empty so a partial outage still yields a useful result.
 */
/** UTC offset (in minutes to ADD to UTC to get local time) for `timeZone` at a given instant. */
function tzOffsetMinutes(atUtcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(
    new Date(atUtcMs),
  );
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const m = tzName.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const hours = parseInt(m[1], 10);
  const mins = m[2] ? parseInt(m[2], 10) : 0;
  return hours * 60 + (hours < 0 ? -mins : mins);
}

/**
 * GitHub's search date qualifiers (`created:`, `author-date:`) are always
 * interpreted in UTC, but `date` here is a calendar day in America/Los_Angeles
 * (see getTodayDate in files.ts). Passing the bare PT date string straight
 * into a UTC-interpreted qualifier silently misses/misattributes activity
 * from roughly 4-8pm PT onward (whenever the UTC day has already rolled
 * over). Compute the explicit UTC instant range for the PT calendar day and
 * use a `qualifier:start..end` range instead.
 */
function utcRangeForLocalDay(date: string, timeZone = "America/Los_Angeles"): string {
  const [y, mo, d] = date.split("-").map(Number);
  const noonUtcGuess = Date.UTC(y, mo - 1, d, 12, 0, 0);
  const offsetMin = tzOffsetMinutes(noonUtcGuess, timeZone);
  const startMs = Date.UTC(y, mo - 1, d, 0, 0, 0) - offsetMin * 60_000;
  const endMs = startMs + 24 * 60 * 60 * 1000 - 1000; // inclusive end, 1s before next day starts
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  return `${iso(startMs)}..${iso(endMs)}`;
}

export async function fetchGitHubActivity(date: string): Promise<GitHubActivity> {
  const octokit = await getOctokit();
  const config = await readConfig();
  const { data: userData } = await octokit.users.getAuthenticated();
  const user = userData.login;
  const orgs = orgList();
  const dateRange = utcRangeForLocalDay(date);

  const repoOf = (item: { repository_url?: string; html_url?: string }) => {
    if (item.repository_url) {
      const parts = item.repository_url.split("/");
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }
    return "";
  };
  const ignored = (repoFullName: string) =>
    config.ignoredRepos.includes(repoFullName.split("/").pop() ?? "");

  const PAGE_SIZE = 100;
  const PAGE_CAP = 5;

  /** Paginate a search endpoint, collecting all items up to PAGE_CAP pages. */
  async function paginate<T>(
    label: string,
    fetchPage: (page: number) => Promise<{ items: T[] }>,
  ): Promise<T[]> {
    const collected: T[] = [];
    for (let page = 1; page <= PAGE_CAP; page++) {
      const { items } = await fetchPage(page);
      collected.push(...items);
      if (items.length < PAGE_SIZE) break;
      if (page === PAGE_CAP) {
        console.warn(`[github] fetchGitHubActivity ${label}: safety cap of ${PAGE_CAP} pages reached, results may be truncated`);
      }
    }
    return collected;
  }

  const issuesCreated: ActivityItem[] = [];
  const prsCreated: ActivityItem[] = [];
  const commits: CommitItem[] = [];

  for (const org of orgs) {
    let orgSucceeded = 0;
    let orgFailed = 0;
    // Issues created
    try {
      const items = await paginate(`issues ${org}`, async (page) => {
        const res = await octokit.search.issuesAndPullRequests({
          q: `is:issue author:${user} org:${org} created:${dateRange}`,
          per_page: PAGE_SIZE,
          page,
        });
        return { items: res.data.items };
      });
      for (const item of items) {
        const repoFullName = repoOf(item);
        if (ignored(repoFullName)) continue;
        issuesCreated.push({ number: item.number, title: item.title, url: item.html_url, repoFullName });
      }
      orgSucceeded++;
    } catch (e) {
      console.error(`[github] fetchGitHubActivity issues ${org}:`, e);
      orgFailed++;
    }

    // PRs created
    try {
      const items = await paginate(`prs ${org}`, async (page) => {
        const res = await octokit.search.issuesAndPullRequests({
          q: `is:pr author:${user} org:${org} created:${dateRange}`,
          per_page: PAGE_SIZE,
          page,
        });
        return { items: res.data.items };
      });
      for (const item of items) {
        const repoFullName = repoOf(item);
        if (ignored(repoFullName)) continue;
        prsCreated.push({ number: item.number, title: item.title, url: item.html_url, repoFullName });
      }
      orgSucceeded++;
    } catch (e) {
      console.error(`[github] fetchGitHubActivity prs ${org}:`, e);
      orgFailed++;
    }

    // Commits authored
    try {
      const items = await paginate(`commits ${org}`, async (page) => {
        const res = await octokit.search.commits({
          q: `author:${user} org:${org} author-date:${dateRange}`,
          per_page: PAGE_SIZE,
          page,
        });
        return { items: res.data.items };
      });
      for (const item of items) {
        const repoFullName = item.repository?.full_name ?? "";
        if (ignored(repoFullName)) continue;
        const sha = item.sha;
        commits.push({
          sha,
          shortSha: sha.slice(0, 7),
          message: item.commit.message.split("\n")[0],
          url: item.html_url,
          repoFullName,
        });
      }
      orgSucceeded++;
    } catch (e) {
      console.error(`[github] fetchGitHubActivity commits ${org}:`, e);
      orgFailed++;
    }

    if (orgSucceeded === 0 && orgFailed > 0) {
      throw new Error(`fetchGitHubActivity: all ${orgFailed} search queries failed for org ${org} on ${date}`);
    }
  }

  console.log(
    `[github] fetchGitHubActivity ${date}: ${issuesCreated.length} issues, ${prsCreated.length} PRs, ${commits.length} commits`,
  );
  return { issuesCreated, prsCreated, commits };
}
