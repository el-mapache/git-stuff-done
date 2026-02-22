# Copilot Instructions

This is LogPilot — a personal daily work log dashboard built with Next.js 16, TypeScript, and Tailwind CSS v4.

## Architecture
- 4-panel dashboard: Raw Work Log editor, Enriched Work Log viewer, TODO list, GitHub Notifications
- File-based storage: `logs/YYYY-MM-DD.md` (raw), `logs/YYYY-MM-DD.rich.md` (enriched), `data/todos.json`
- AI enrichment via GitHub Models API (gpt-4o) using `gh auth token`
- Hourly auto-commit of logs and todos to git
- GitHub notifications via Octokit REST API

## Conventions
- All components use dark theme (zinc-900/950 backgrounds)
- API routes are in `src/app/api/`
- Shared utilities in `src/lib/`
- Client components use `'use client'` directive

## Custom Instructions
- Always update the README.md file when you add or modify features to keep the documentation in sync with the code.
