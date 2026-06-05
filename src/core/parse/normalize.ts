// Text normalization — the foundation of stable, whitespace-invariant IDs (spec §6.1).

/**
 * Clean up a block of text without destroying its line/paragraph structure:
 *  - unify CRLF/CR -> LF
 *  - collapse runs of spaces/tabs to a single space, trim each line
 *  - collapse 3+ consecutive newlines to a single blank line
 * Chinese punctuation and content are preserved.
 */
export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Collapse ALL whitespace (including newlines and full-width spaces) to single
 * spaces, then trim. This is the canonical form hashed for stable paragraph IDs,
 * so incidental whitespace/reflow differences never change an ID.
 */
export function canonicalizeForHash(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}
