# Copilot Instructions

This is git-stuff-done — a personal daily work log dashboard built with Next.js 16, TypeScript, and Tailwind CSS v4.

## Architecture
- 5-panel dashboard: Raw Work Log editor, Enriched Work Log viewer, TODO list, My PRs, GitHub Notifications
- File-based storage: `logs/YYYY-MM-DD.md` (raw), `logs/YYYY-MM-DD.rich.md` (enriched), `data/todos.json`, `data/config.json` (settings)
- AI enrichment via `@github/copilot-sdk` (requires Copilot CLI); summary generation uses a user-selectable model
- Hourly auto-commit of logs, summaries, and todos to git
- GitHub data (PRs, notifications) via Octokit REST API
- Shared hooks in `src/hooks/` (e.g. `useVisibilityPolling`)

## Conventions
- Full light + dark theme via CSS variables in `globals.css`; use semantic tokens (`bg-background`, `text-foreground`, `bg-card`, etc.) not hardcoded zinc/violet classes
- API routes are in `src/app/api/`
- Shared utilities in `src/lib/`
- Client components use `'use client'` directive
- Overlays/popovers must use `createPortal(el, document.body)` with `position: fixed` and `z-index: 9999` to escape panel stacking contexts
- Polling components use `useVisibilityPolling` (pauses when tab is hidden) and AbortController to cancel stale requests
- Cross-panel communication (e.g. insert-at-cursor) uses a callback ref registration pattern via `onRegisterXxx` props

## Custom Instructions
- Always update the README.md file when you add or modify features to keep the documentation in sync with the code.
