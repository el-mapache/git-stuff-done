/**
 * Support for enriching a matched Slack message with its real surrounding
 * conversation (full thread, or a small before/after window for standalone
 * messages), so the Daily Activity Slack summarizer sees more than just the
 * one isolated line I sent. See docs/superpowers/specs/2026-07-07-slack-thread-context-design.md
 * for the full design.
 */

/**
 * Normalize Slack mrkdwn link syntax to a bare URL. Slack's raw message
 * `text` field renders links as `<url|label>` (link with a display label)
 * or `<url>` (bare autolink) rather than a plain URL — the `<url|label>`
 * form is NOT handled correctly by the app's existing linkification helpers
 * (`applyLinkification` in src/lib/copilot.ts only understands bare URLs and
 * label-less `<url>` autolinks), so any Slack text captured anywhere in this
 * app must be run through this first, before it reaches the model or any
 * linkify step.
 */
export function cleanSlackText(raw: string): string {
  return raw
    .replace(/<([^<>|]+)\|[^<>]*>/g, "$1") // <url|label> -> url
    .replace(/<([^<>]+)>/g, "$1"); // <url> -> url
}
