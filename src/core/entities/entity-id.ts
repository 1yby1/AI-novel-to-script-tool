import { createHash } from "node:crypto";

/** Canonical form for hashing/dedup: drop all whitespace, lowercase (spec §6.2). */
export function canonicalizeName(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

/** First 6 hex chars of SHA-256 — the uniqueness/determinism guarantee for entity IDs. */
export function hash6(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 6);
}

/** Optional readable prefix: lowercase ASCII alphanumerics only (empty for Chinese names). */
export function asciiSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16);
}

/**
 * Deterministic entity ID `${prefix}_${slug}_${hash6}` (slug omitted when empty).
 * hash6 is over the canonical name, so the same name always yields the same ID.
 */
export function makeEntityId(prefix: "char" | "loc", name: string): string {
  const h = hash6(canonicalizeName(name));
  const slug = asciiSlug(name);
  return slug ? `${prefix}_${slug}_${h}` : `${prefix}_${h}`;
}
