// Pure helpers for inserting/replacing a delimited block in markdown.
// A block is identified by HTML comment markers so it survives round-trips
// through the markdown editor and is safe to replace idempotently.

export function startMarker(key: string): string {
  return `<!-- ${key}:start -->`;
}

export function endMarker(key: string): string {
  return `<!-- ${key}:end -->`;
}

/**
 * Replace the existing `key` block in `source` with `block`, or append it
 * (separated by a blank line) if no block exists yet. `block` is the full
 * content that goes BETWEEN the markers (markers are added here).
 * Idempotent: running twice with the same inputs yields the same output.
 */
export function upsertBlock(source: string, key: string, block: string): string {
  const start = startMarker(key);
  const end = endMarker(key);
  const wrapped = `${start}\n${block.trim()}\n${end}`;

  const startIdx = source.indexOf(start);
  const endIdx = source.indexOf(end);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = source.slice(0, startIdx);
    const after = source.slice(endIdx + end.length);
    return `${before}${wrapped}${after}`;
  }

  const base = source.trimEnd();
  return base.length > 0 ? `${base}\n\n${wrapped}\n` : `${wrapped}\n`;
}
