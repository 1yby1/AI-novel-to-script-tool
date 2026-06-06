import { ScriptSchema, type Script } from "../schema/script-schema";
import { checkAnchor, type CanonicalSource } from "./anchor";
import { checkConstraints } from "./constraints";
import { computeQualityReport, type QualityReport } from "./quality-report";
import { checkReferential } from "./referential";
import { validateSchema, type ValidationItem } from "./schema-validate";
import { stripInvalidSourceRefs } from "./repair";
import { checkIntegrity } from "./integrity";

export type ValidationMode = "generate" | "edit";

export interface FullValidationOptions {
  mode?: ValidationMode;
  canonical?: CanonicalSource;
  repairedRefs?: ReadonlyArray<string>;
}

export interface FullValidationResult {
  valid: boolean;
  errors: ValidationItem[];
  warnings: ValidationItem[];
  quality_report: QualityReport | null;
  script: Script | null;
}

const COVERAGE_WARN_THRESHOLD = 0.5;

const PLACEHOLDER_QUALITY_REPORT = {
  source_coverage_ratio: 0,
  referenced_paragraph_count: 0,
  total_paragraph_count: 0,
  missing_source_refs: [],
  repaired_refs: [],
  untraceable_scenes: [],
  unreferenced_key_paragraphs: [],
  constraint_warnings: [],
  manual_review_suggestions: [],
};

function weakTraceabilityWarnings(report: QualityReport): ValidationItem[] {
  const warnings: ValidationItem[] = [];
  report.untraceable_scenes.forEach((path) => {
    warnings.push({
      path,
      code: "WEAK_TRACEABILITY",
      message: "场景缺少场景级与 beat 级 source_refs，建议补充溯源。",
    });
  });
  if (report.total_paragraph_count > 0 && report.source_coverage_ratio < COVERAGE_WARN_THRESHOLD) {
    warnings.push({
      path: "quality_report.source_coverage_ratio",
      code: "WEAK_TRACEABILITY",
      message: `原文覆盖率偏低：${Math.round(report.source_coverage_ratio * 100)}%`,
    });
  }
  return warnings;
}

/**
 * Full deterministic validation used by API routes. It assumes callers pass a
 * parsed object, not YAML text. For generate mode, invalid source_refs are stripped
 * and recorded; for edit mode, constraint warnings are upgraded to hard violations.
 */
export function validateScriptObject(input: unknown, options: FullValidationOptions = {}): FullValidationResult {
  const mode = options.mode ?? "edit";
  // quality_report is always recomputed below (spec §11), so ignore any user/model-supplied
  // value: replace it with a valid placeholder before structural validation, so a deleted or
  // mangled quality_report never blocks validation (it is recomputed and injected regardless).
  const normalizedInput =
    input && typeof input === "object" && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>), quality_report: PLACEHOLDER_QUALITY_REPORT }
      : input;
  const schemaResult = validateSchema(normalizedInput);
  const errors: ValidationItem[] = [...schemaResult.errors];
  const warnings: ValidationItem[] = [...schemaResult.warnings];

  const parsed = ScriptSchema.safeParse(normalizedInput);
  if (!parsed.success) {
    return { valid: false, errors, warnings, quality_report: null, script: null };
  }

  let script = parsed.data;
  let repairedRefs = [...(options.repairedRefs ?? [])];

  if (mode === "generate") {
    const validParagraphIds = options.canonical?.paragraphIds ?? script.source_paragraphs.map((p) => p.id);
    const repaired = stripInvalidSourceRefs(script, validParagraphIds);
    script = repaired.script;
    repairedRefs = [...new Set([...repairedRefs, ...repaired.repairedRefs])];
  }

  errors.push(...checkReferential(script));
  const integrity = checkIntegrity(script);
  errors.push(...integrity.errors);
  warnings.push(...integrity.warnings);
  const anchor = checkAnchor(script, options.canonical);
  errors.push(...anchor.errors);
  warnings.push(...anchor.warnings);

  const constraintWarnings = checkConstraints(script);
  if (mode === "edit") {
    errors.push(...constraintWarnings.map((w) => ({ ...w, code: "CONSTRAINT_VIOLATION" })));
  } else {
    warnings.push(...constraintWarnings);
  }

  const quality_report = computeQualityReport(script, {
    canonicalParagraphIds: options.canonical?.paragraphIds,
    repairedRefs,
    constraintWarnings,
  });
  warnings.push(...weakTraceabilityWarnings(quality_report));

  const finalScript: Script = { ...script, quality_report: quality_report as Script["quality_report"] };
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    quality_report,
    script: finalScript,
  };
}
