import type { Script } from "../schema/script-schema";
import type { ValidationItem } from "./schema-validate";
import { computeSourceFingerprint } from "../parse/fingerprint";

export interface CanonicalSource {
  paragraphIds: ReadonlyArray<string>;
  fingerprint: string;
}

export interface AnchorResult {
  errors: ValidationItem[];
  warnings: ValidationItem[];
}

function collectAllRefs(script: Script): string[] {
  const refs: string[] = [];
  script.characters.forEach((c) => refs.push(...c.source_refs));
  script.locations.forEach((l) => refs.push(...l.source_refs));
  script.adaptation_notes.forEach((n) => { if (n.source_refs) refs.push(...n.source_refs); });
  script.episodes.forEach((ep) =>
    ep.scenes.forEach((sc) => {
      refs.push(...sc.source_refs);
      sc.beats.forEach((b) => refs.push(...b.source_refs));
    }),
  );
  return refs;
}

/**
 * Anchor a YAML to its original parse (spec §4.4). With canonical info (strong): the YAML's
 * source_paragraphs and all source_refs must be subsets of canonical IDs, and
 * metadata.source_fingerprint must equal the canonical fingerprint — any deviation is
 * SOURCE_MISMATCH. Without canonical (standalone): recompute the fingerprint from the YAML's
 * own paragraphs and compare to metadata.source_fingerprint, plus a SOURCE_UNVERIFIED warning.
 */
export function checkAnchor(script: Script, canonical?: CanonicalSource): AnchorResult {
  const errors: ValidationItem[] = [];
  const warnings: ValidationItem[] = [];
  const allRefs = [...new Set(collectAllRefs(script))];

  if (canonical) {
    const canon = new Set(canonical.paragraphIds);
    script.source_paragraphs.forEach((p, i) => {
      if (!canon.has(p.id)) {
        errors.push({ path: `source_paragraphs[${i}].id`, code: "SOURCE_MISMATCH", message: `段落 ID 不在原始解析中：${p.id}` });
      }
    });
    const strayRefs = allRefs.filter((r) => !canon.has(r));
    if (strayRefs.length > 0) {
      errors.push({ path: "source_refs", code: "SOURCE_MISMATCH", message: `引用了原始解析中不存在的段落：${strayRefs.join(", ")}` });
    }
    if (script.metadata.source_fingerprint !== canonical.fingerprint) {
      errors.push({ path: "metadata.source_fingerprint", code: "SOURCE_MISMATCH", message: "source_fingerprint 与原始解析不一致" });
    }
  } else {
    warnings.push({ path: "metadata.source_fingerprint", code: "SOURCE_UNVERIFIED", message: "未提供 canonical 源，源真实性无法对照原始解析" });
    const recomputed = computeSourceFingerprint(script.source_paragraphs);
    if (script.metadata.source_fingerprint !== recomputed) {
      errors.push({ path: "metadata.source_fingerprint", code: "SOURCE_MISMATCH", message: `source_fingerprint 与自带 source_paragraphs 不一致（应为 ${recomputed}）` });
    }
  }

  return { errors, warnings };
}
