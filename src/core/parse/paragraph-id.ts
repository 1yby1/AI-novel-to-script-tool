import { createHash } from "node:crypto";
import { canonicalizeForHash } from "./normalize";

/** First 8 hex chars of SHA-256 over the canonicalized text (spec §6.1). */
export function hash8(text: string): string {
  return createHash("sha256").update(canonicalizeForHash(text)).digest("hex").slice(0, 8);
}

/** Stable paragraph ID: `ch{chapterNo}_p{paragraphNo}_{hash8}`. */
export function makeParagraphId(chapterNo: number, paragraphNo: number, text: string): string {
  return `ch${chapterNo}_p${paragraphNo}_${hash8(text)}`;
}
