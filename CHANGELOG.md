# Changelog

All notable changes to git-stuff-done are documented here.

## 2026-07-28

### Fixed

- **Regenerating a past day's Daily Activity no longer comes up empty** — GitHub activity for older days used to disappear because it relied on a feed that only keeps your most recent activity. Daily Activity now also looks up the issues and pull requests you opened, merged, and closed on that specific date, so historical days show your GitHub work correctly. (Reviews, comments, and pushed commits are still only available for recent days.)
- **Daily Activity no longer shows "undefined" as a PR or issue title** — when GitHub's activity feed doesn't include a title for a referenced pull request or issue (which can happen for large monorepo or agent-created PRs), the real title is now always fetched and shown instead of a placeholder.

### Changed

- **Daily Activity's Slack and Mentions summaries now leave out empty threads** — threads with no substantive discussion are dropped entirely rather than appearing as filler bullets like "No activity to summarize in this thread," and a channel is omitted when nothing meaningful remains to report for it.

## 2026-07-21

### Changed

- **Daily Activity's Slack and Mentions summaries now ignore emoji reactions and use judgment about relevance** — lone reaction-style messages (like a "👍" or ":+1:") are no longer summarized as if they were substantive, and jokes/banter/throwaway comments are given minimal weight instead of being treated as meaningful updates.

## 2026-07-09

### Fixed

- **AI work-log summaries now show real titles for linked GitHub issues/PRs** — instead of a bare URL, referenced issues and pull requests are now rendered as proper links with their actual title, matching the linkification already used elsewhere in the app.

### Changed

- **Slack activity summaries now include real conversation context** — instead of summarizing just the isolated message you sent, the Daily Activity Slack summary now pulls in the rest of the thread (or a few nearby messages for standalone ones) so the AI can reason about what was actually being discussed, not just guess from your side of the conversation alone.

### Fixed

- **Slack messages containing links no longer show broken/garbled formatting** in the activity log.

## 2026-07-07

### Added

- **Daily Activity now includes a Mentions section** — a new `### Mentions` section lists Slack messages where others `@mention` you, grouped by channel/DM and thread, reasoning about why you were mentioned (question, review request, FYI, decision needed, etc.). Unlike the existing Slack summary, this checks **every** channel and DM you're in — it's not limited by the Slack Channels allowlist — since you'd want to know about a mention regardless of which channel it landed in. Messages from bot accounts are automatically filtered out.

### Fixed

- **The work log editor now supports turning text into links** — you can select existing text and paste a URL over it to turn that text into a link (keeping your original words as the label), and you can type markdown link syntax like `[label](url)` directly and it will convert into a real link as soon as you finish typing it.

## 2026-07-06

### Added

- **Slack Channels allowlist for Daily Activity** — you can now specify exactly which public Slack channels should be checked for the Daily Activity Slack summary, via the new **Slack Channels** list in Settings. Leave it empty (the default) to keep checking every public channel you posted in that day.

## 2026-07-02

### Changed

- **Daily Activity Slack summary is now concrete bullet points, not a vague blurb** — the Slack section now lists a few specific bullet points per channel (what was actually discussed, asked, or decided) instead of a single generic one-liner. The blended GitHub+Slack narrative paragraph at the top has been removed entirely — Daily Activity is now just the GitHub and Slack bullet lists, meant to complement your normal daily log rather than restate it.
- **Slack summary is now broken out by thread, with reasoned context** — instead of one flat list of bullets per channel, each channel now shows one bullet per conversation thread, linking back to that thread. Bullets try to reason about the purpose behind your messages (question, status update, decision, bug report, etc.) instead of just restating the text, and no longer use emoji.
- **GitHub PR/issue links mentioned in Slack messages are now linkified** — the same `repo#number: title` linked format used elsewhere in the app (e.g. the work log's linkify action) is now applied to bare GitHub links preserved from your Slack messages.

### Added

- **Daily Activity is now also saved as a standalone summary file each evening** — in addition to the automatic ~6pm update to your work log, a copy of that day's Daily Activity is saved to `summaries/` around 8pm.

### Fixed

- **Automatic Daily Activity generation no longer overwrites an entry that's already there** — if the log already has a Daily Activity block for the day (e.g. from an earlier scheduler run before a server restart), the evening triggers now leave it alone instead of regenerating and clobbering it. The 8pm summary-file save now reuses that existing block rather than re-running GitHub/Slack collection. Manually clicking **Daily activity** still always refreshes it, since that's an explicit request.

## 2026-07-01

### Changed

- **Daily Activity now covers all your GitHub activity** — not just issues/PRs you created and commits you authored, but also PR reviews you gave (approved / requested changes / commented), and comments you left on issues and PRs, plus PRs and issues you closed or merged. Each entry links back to the original GitHub page.

---

## 2026-06-30

### Added

- **Daily Activity summary** — Your work log now gets an automatic end-of-day section listing the GitHub issues and pull requests you created and the commits you authored (including Copilot agent work), alongside an AI summary of your public Slack channel activity grouped by channel. It's generated automatically each evening and can be triggered any time with the new **Daily activity** button.

---

## 2026-06-24

### Added

- **Scratchpad linkify** — the Scratchpad panel now includes a Linkify button that converts bare GitHub and Slack URLs in your scratchpad into richer markdown links.

---

## 2026-05-21

### Added

- **Scratchpad panel** — a persistent markdown editor that lives across all days, stored in a single file and auto-committed with the rest of your data

---

## 2026-05-18

### Added

- **PR filter pills** — the My PRs panel now shows filter pills (Approved, Merging, Draft, Needs Review, Changes Requested, CI Failing, Copilot) to quickly narrow the list; pills show match counts and auto-hide when empty

---

## 2026-05-01

### Added

- **Branch name copy** — clicking the branch pill in My PRs copies the branch name to clipboard; a copy icon appears on hover and swaps to a green checkmark for 2 seconds after copying

---

## 2026-04-29

### Added

- **Fuzzy log text search** — new Search tab in the AI modal lets you search across all work log files using keyword matching, with results highlighted inline
- **AI search keyword pre-filter** — AI search mode can optionally narrow logs by keyword before sending them to the AI model, reducing token usage on large corpora
- **Unified search modal** — text search, AI search, and AI+keywords modes combined into a single interface; previous separate modals merged
- **Saveable custom prompts** — summary prompts can be saved, renamed, and deleted from a new Prompts tab in the AI modal; built-in prompts (Daily Standup, Weekly Report, etc.) are always available
- **Export Raw Logs** — new button in the AI modal footer downloads all work log entries for the selected date range as a single combined markdown file (inline base64 images stripped for clean output)
- **PR state badge on review notifications** — Notifications panel now shows a PR state badge on review-requested notifications

### Fixed

- AI modal footer buttons no longer crowd when a summary result is present — Copy / Download .md / Save & Commit appear in a dedicated row above the main action buttons
- Summary generation timeout increased to 5 minutes to handle large date ranges

---

## 2026-04-28

### Added

- My PRs now shows explicit review-decision indicators for approved and changes-requested states
- Reference pills (linked PRs on issues, PR metadata) use a unified `ReferencePill` component for consistent styling across My PRs and My Issues

## 2026-04-27

### Added

- **PR branch name** displayed in the My PRs panel as a pill badge alongside the repo, PR number, and line change counts

### Fixed

- Stabilized refresh callbacks in My PRs and My Issues panels using `isDemoRef` pattern to prevent duplicate fetches on remount
- Coalesced concurrent `/api/prs` and `/api/issues` requests server-side so rapid panel switches share one in-flight request instead of firing multiple
- Serialized authored/assigned GitHub Search API calls and added retry-on-zero to handle spurious empty responses during GitHub Search incidents
- Preserved cached PR/issue data when the API returns an empty result set, preventing panels from incorrectly clearing while GitHub Search is degraded

### Changed

- My Issues panel: open PR pills now use GitHub's green (`#1F883D`), merged PR pills use GitHub's purple (`#8250DF`)
- Copilot badge on issues renamed to "Assigned to Copilot" and restyled to neutral gray

---

## 2026-04-17

### Added

- **Widescreen row layout mode** — panels arrange horizontally in a single row on wide displays; toggle via layout menu

### Changed

- **Facelift** — replaced purple theme with a cool blue-teal color palette across the entire dashboard
- Pointer cursor on interactive buttons; bolder date header typography

---

## 2026-04-16

### Added

- **Drag-to-reorder todos** — grab any TODO item and drag it to reorder within the list

### Fixed

- Used `CSS.Translate` instead of `CSS.Transform` during drag to prevent text scaling artifacts

---

## 2026-04-15

### Added

- Bare Slack URLs pasted into the log editor are automatically linkified as `[Slack link](url)`

---

## 2026-04-08

### Fixed

- Pressing Space at the end of a link no longer stays inside the link mark; cursor correctly escapes to plain text

---

## 2026-04-07

### Added

- **Image support** — drag-and-drop or paste images directly into the Work Log editor; images are stored in `attachments/YYYY-MM-DD/`
- **Code fencing** — triple-backtick code blocks rendered in the editor with monospace styling

---

## 2026-04-03

### Added

- **Drag-and-drop panel reordering** — grab any panel by its title bar and drag it to a new position; order persists to `localStorage`
- Infinite scroll height in column layout mode

### Fixed

- Grip icon replaces invisible drag overlay for clearer affordance
- Single `SortableContext` for cross-column drag; reset button restores default panel order
- Drag handle restricted to title bar only; grab cursor removed from panel card body

---

## 2026-04-01

### Added

- **Slack thread viewer** — click a Slack link in the log to open a rich-text modal preview of the thread; available in demo mode
- `@mention` autocomplete for GitHub org members in the Work Log editor

### Changed

- PR/issue cross-references unified to `Title (owner/repo#number)` format

---

## 2026-03-25

### Added

- AI search results can be saved and downloaded; saved results visible in the Summaries modal

---

## 2026-03-24

### Changed

- Agent Sessions panel now only shows sessions with a linked PR
- Agent Sessions: PR state pills (open/merged/closed), title links to Copilot agent task page; merged PRs filtered out by default
- Neutral color used for open/draft PR pills

### Fixed

- Draft PR sessions now visible; fixed null `pullRequestUrl` crash

---

## 2026-03-23

### Added

- **Agent Sessions panel** — shows Copilot coding agent tasks from GitHub via `gh agent-task list`; sessions grouped by date with PR badges (open/merged/closed), state indicators (running/timed out), and hover-to-insert into Work Log; hidden by default, enabled via panel menu
- New `GET /api/sessions` route backed by `gh agent-task list` (requires gh CLI ≥ 2.80.0)

### Fixed

- Linkify button remained permanently disabled when starting a new empty log and typing — `content` state was never updated from editor input, only from the API fetch on load
- Trailing space now inserted after links pasted or inserted into the log editor, so the cursor escapes the link node and typing continues naturally

### Changed

- Cross-panel link inserts (from MyPRs, MyIssues, Notifications) now append a trailing space
- Direct paste (Ctrl+V) of URLs/markdown links now appends a trailing space via a new Tiptap extension

---

## 2026-03-12

### Fixed

- Commit button now correctly distinguishes server errors from no-changes response (#15)

### Performance

- AI search optimized: single LLM round-trip, fast classifier, incremental recent-first accumulation (#12)

---

## 2026-03-11

### Added

- Configurable font size setting persisted to `config.json`; font size and config supported in demo mode

### Fixed

- Commit button size instability and jarring color flash on state change

---

## 2026-03-10

### Added

- Stop button to cancel in-progress AI searches, with server-side abort support
- Auto-PR feature (#11)
- Copilot assign button and modal in AiModal

### Fixed

- Stream error when aborting an in-progress search
- Recent-first regression: restored log accumulation across search iterations
- Classifier prompt improved to avoid exhaustive misclassification

---

## 2026-03-09

### Added

- Saved Summaries modal: browse, preview, and delete saved summaries (#10)
- AI Usage preset and smart date auto-fill for summary templates
- Rich text AI results with markdown-on-copy; streaming search progress; dynamic model selection (#8)
- `MarkdownViewer` component with prose styles

### Fixed

- Strip issue/PR sub-paths and fragments before linkifying to avoid broken links
- Badge colors; MarkdownViewer spacing, line-height, and code block contrast
- Capitalize AI and other acronyms in summary labels

---

## 2026-03-08

### Added

- Combined AI modal replacing separate Search and Summary modals — single modal with tabs
- Stream search progress via NDJSON for real-time feedback
- Save filename slug derived from prompt text

### Changed

- Consolidated to single demo deployment workflow

---

## 2026-02-22

### Added

- Calendar date picker with per-day content indicators
- Summary model picker
- Demo mode for public deployment
- Save AI summaries to the repository
- Configurable ignored repos for GitHub org filtering

### Changed

- Rebranded project from LogPilot to **git-stuff-done**
- Major layout overhaul: dark mode, resizable panels, merged log view
- External data directory support; general cleanup and documentation pass

---

## 2026-02-21

### Added

- Initial dashboard implementation (LogPilot): Work Log editor, TODO list, My PRs, GitHub Notifications panels
- Rich markdown editor with auto-enrichment on save and date-aware TODOs
- Inline TODO editing and AI suggestion improvements
- GitHub notifications filtered to open issues and PRs only
- Hourly auto-commit and push to GitHub
- Motivational quote header
- Server-side logging for all API routes
