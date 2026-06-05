import { createHash } from "node:crypto";

/**
 * Deterministic fingerprint of the source: first 16 hex of SHA-256 over the ordered
 * paragraph IDs. Each ID embeds a content hash + position, so the fingerprint changes if
 * any paragraph's content, order, or count changes. Used to anchor a YAML back to the
 * exact parse it came from (spec §4.4).
 */
export function computeSourceFingerprint(paragraphs: ReadonlyArray<{ id: string }>): string {
  const joined = paragraphs.map((p) => p.id).join("\n");
  return createHash("sha256").update(joined).digest("hex").slice(0, 16);
}
