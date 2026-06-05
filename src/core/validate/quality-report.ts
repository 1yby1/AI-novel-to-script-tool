import type { Script } from "../schema/script-schema";
import type { ValidationItem } from "./schema-validate";

export interface QualityReportInput {
  /** Authoritative paragraph IDs from the original parse; falls back to the script's own. */
  canonicalParagraphIds?: ReadonlyArray<string>;
  /** Invalid refs the generation path auto-stripped (recorded for transparency). */
  repairedRefs?: ReadonlyArray<string>;
  /** Constraint findings (from checkConstraints) to embed + summarize. */
  constraintWarnings?: ReadonlyArray<ValidationItem>;
}

export interface QualityReport {
  source_coverage_ratio: number;
  referenced_paragraph_count: number;
  total_paragraph_count: number;
  missing_source_refs: string[];
  repaired_refs: string[];
  untraceable_scenes: string[];
  unreferenced_key_paragraphs: string[];
  constraint_warnings: { code: string; message: string }[];
  manual_review_suggestions: string[];
}

const COVERAGE_WARN_THRESHOLD = 0.5;
const KEY_PREVIEW_MIN_LEN = 20;
const MAX_KEY_PARAGRAPHS = 10;

function collectRefs(script: Script): string[] {
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
 * Compute the quality report deterministically (spec §11). Always recomputed; the script's
 * own quality_report is never read. coverage = distinct valid refs / total source paragraphs.
 */
export function computeQualityReport(script: Script, input: QualityReportInput = {}): QualityReport {
  const validIds = new Set(input.canonicalParagraphIds ?? script.source_paragraphs.map((p) => p.id));
  const total = validIds.size;

  const uniqueRefs = [...new Set(collectRefs(script))];
  const referenced = uniqueRefs.filter((r) => validIds.has(r));
  const missing = uniqueRefs.filter((r) => !validIds.has(r));
  const referencedSet = new Set(referenced);

  const untraceable: string[] = [];
  script.episodes.forEach((ep, ei) =>
    ep.scenes.forEach((sc, si) => {
      const sceneEmpty = sc.source_refs.length === 0;
      const beatsEmpty = sc.beats.every((b) => b.source_refs.length === 0);
      if (sceneEmpty && beatsEmpty) untraceable.push(`episodes[${ei}].scenes[${si}]`);
    }),
  );

  const unreferencedKey = script.source_paragraphs
    .filter((p) => !referencedSet.has(p.id) && p.text_preview.length >= KEY_PREVIEW_MIN_LEN)
    .slice(0, MAX_KEY_PARAGRAPHS)
    .map((p) => p.id);

  const coverage = total === 0 ? 0 : referenced.length / total;
  const constraintWarnings = (input.constraintWarnings ?? []).map((w) => ({ code: w.code, message: w.message }));

  const suggestions: string[] = [];
  if (coverage < COVERAGE_WARN_THRESHOLD) suggestions.push(`原文覆盖率偏低（${(coverage * 100).toFixed(0)}%），建议补充更多场景的溯源引用。`);
  if (untraceable.length > 0) suggestions.push(`有 ${untraceable.length} 个场景缺少溯源，建议补充 source_refs。`);
  if (missing.length > 0) suggestions.push(`存在 ${missing.length} 个无效引用，建议核对段落 ID。`);
  constraintWarnings.forEach((w) => suggestions.push(w.message));

  return {
    source_coverage_ratio: Number(coverage.toFixed(4)),
    referenced_paragraph_count: referenced.length,
    total_paragraph_count: total,
    missing_source_refs: missing,
    repaired_refs: [...(input.repairedRefs ?? [])],
    untraceable_scenes: untraceable,
    unreferenced_key_paragraphs: unreferencedKey,
    constraint_warnings: constraintWarnings,
    manual_review_suggestions: suggestions,
  };
}
