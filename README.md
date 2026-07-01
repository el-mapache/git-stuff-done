# ✨ git-stuff-done

**git-stuff-done** is your personal developer dashboard designed to keep you in the flow. It combines a distraction-free markdown editor for your daily work logs with AI superpowers. Track your work, manage your PRs and GitHub notifications, and generate work summaries all in one place.

### 👉 [check out the demo](https://therzka.github.io/git-stuff-done/) 👈

(or see [screenshots](#screenshots) below)

## Features

- **📝 Work Log Editor** — Hybrid markdown editor with inline rendering. Supports drag-and-drop images, `@mention` autocomplete for GitHub org members, and Slack thread previews.
- **✨ AI Assistant** — Summarize your work logs for standups or weekly reports with built-in prompt templates plus saveable, reusable custom prompts. Also includes **Export Raw Logs** — download all work log entries for any date range as a single combined markdown file.
- **🔎 Search** — Search across all logs with natural language queries from the dedicated search modal.
- **✅ TODO List** — Manual TODOs and AI-suggested action items based on your work log.
- **🔀 My PRs** — Live feed of your open PRs with status badges and filter pills (Approved, Merging, Draft, Needs Review, Changes Requested, CI Failing, Copilot).
- **🐛 My Issues** — Open issues assigned to you with linked PR status and one-click Copilot agent assignment.
- **🔔 Notifications** — Filtered GitHub notifications for reviews, mentions, and assignments.
- **🤖 Agent Sessions** — Browse recent Copilot Cloud Agent sessions with summaries and PR/commit links.
- **📝 Scratchpad** — Persistent free-form markdown editor that lives across all days, with a built-in linkify action for turning bare GitHub and Slack links into richer markdown links.
- **🚀 Auto-commit & Push** — Hourly auto-commit of your logs and TODOs to a git repository
- **📊 Daily Activity** — Auto-generated end-of-day log appended to your work log: a factual list of the GitHub issues/PRs you created and commits you authored (including Copilot agent PRs), plus an AI summary of your public-channel Slack activity grouped by channel and a blended narrative. Runs automatically each evening and on demand via the **Daily activity** button.


## Prerequisites

- **Node.js** 20+
- **GitHub Copilot CLI** (`copilot`) in your PATH — [installation guide](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli)
- **GitHub Personal Access Token** with Issues, PRs, Notifications, Actions, and Contents scopes (write access required for Copilot agent assignment)
- **GitHub CLI** (`gh`) — optional fallback for GitHub API access
- **gh-slack extension** — optional, enables Slack thread viewing: `gh extension install https://github.com/rneatherway/gh-slack`
- **[github/copilot-slack-mcp](https://github.com/github/copilot-slack-mcp) plugin** — optional, enables the Daily Activity Slack summary:
  ```bash
  copilot plugin marketplace add github/copilot-slack-mcp \
    && copilot plugin install slack-mcp@github-slack-mcp
  # then run any Slack query in `copilot` once to complete browser OAuth
  ```
  This is read-only and degrades gracefully — if the plugin isn't installed or authenticated, the Daily Activity section still renders the GitHub list with a "_Slack summary unavailable._" note.


## Setup

1. **Fork, then clone your fork:**

   ```bash
   git clone https://github.com/<your-username>/git-stuff-done git-stuff-done
   cd git-stuff-done
   npm install
   ```

   > ⚠️ Do not clone this repo directly — auto-commit pushes to your git remote.

2. **Create a GitHub PAT** at https://github.com/settings/personal-access-tokens/new with Issues, Pull requests, Notifications, Actions, and Contents permissions. If your org requires SSO, authorize the token for your org.

3. **Configure environment:**

   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local`:
   - `GITHUB_READ_TOKEN` — the PAT from step 2
   - `GITHUB_ORG` — your GitHub org name
   - `GIT_STUFF_DONE_DATA_DIR` — (recommended) path to a separate git repo for logs/TODOs

4. **Run the dashboard:**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000

## Environment Variables

| Variable                  | Default                           | Description                                                             |
| ------------------------- | --------------------------------- | ----------------------------------------------------------------------- |
| `GITHUB_ORG`              | _(none)_                          | GitHub org to filter notifications, PRs, and links                      |
| `GITHUB_READ_TOKEN`       | _(falls back to `gh auth token`)_ | GitHub PAT with Issues, PRs, Notifications, Actions, Contents scopes    |
| `GIT_STUFF_DONE_DATA_DIR` | `./` (app dir)                    | Path to a git repo where `logs/` and `data/` will be stored             |
| `DAILY_ACTIVITY_MODEL`    | `gpt-4.1`                         | Model used to summarize Slack activity for the daily log                |

The evening hour Daily Activity generation runs at is configurable via `dailyActivityHour` in `data/config.json` (default `18`, local Pacific time).


## Screenshots

|                     Light Mode                      |                     Dark Mode                      |
| :-------------------------------------------------: | :------------------------------------------------: |
| <img src="screenshots/lightmode.png" width="400" /> | <img src="screenshots/darkmode.png" width="400" /> |
