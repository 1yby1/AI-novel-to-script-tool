import { ScriptSchema, KNOWN_KEYS } from "../schema/script-schema";

export interface ValidationItem {
  path: string;
  code: string; // SCHEMA_ERROR | UNKNOWN_FIELD
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: ValidationItem[];
  warnings: ValidationItem[];
}

/** Render a Zod issue path like ["episodes",1,"scenes",0] into "episodes[1].scenes[0]". */
export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out ? `.${String(seg)}` : String(seg);
  }
  return out;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function checkKeys(obj: unknown, known: readonly string[], path: string, out: ValidationItem[]): void {
  const rec = asRecord(obj);
  if (!rec) return;
  for (const k of Object.keys(rec)) {
    if (!known.includes(k)) {
      out.push({ path: path ? `${path}.${k}` : k, code: "UNKNOWN_FIELD", message: `未知字段：${k}` });
    }
  }
}

/**
 * Walk the known container structure and flag unknown keys as non-blocking warnings.
 * Containers are looseObject (unknown keys are kept, not errored), so warnings are how
 * the author learns about stray fields. Beats are validated strictly by Zod, so they are
 * intentionally not walked here.
 */
function collectUnknownFieldWarnings(input: unknown): ValidationItem[] {
  const out: ValidationItem[] = [];
  const root = asRecord(input);
  if (!root) return out;

  checkKeys(root, KNOWN_KEYS.root, "", out);
  checkKeys(root.metadata, KNOWN_KEYS.metadata, "metadata", out);
  checkKeys(asRecord(root.metadata)?.generator, KNOWN_KEYS.generator, "metadata.generator", out);
  checkKeys(root.adaptation_constraints, KNOWN_KEYS.adaptation_constraints, "adaptation_constraints", out);
  asArray(root.source_chapters).forEach((c, i) => checkKeys(c, KNOWN_KEYS.source_chapter, `source_chapters[${i}]`, out));
  asArray(root.source_paragraphs).forEach((p, i) => checkKeys(p, KNOWN_KEYS.source_paragraph, `source_paragraphs[${i}]`, out));
  asArray(root.characters).forEach((c, i) => checkKeys(c, KNOWN_KEYS.character, `characters[${i}]`, out));
  asArray(root.locations).forEach((l, i) => checkKeys(l, KNOWN_KEYS.location, `locations[${i}]`, out));
  asArray(root.episodes).forEach((e, i) => {
    checkKeys(e, KNOWN_KEYS.episode, `episodes[${i}]`, out);
    asArray(asRecord(e)?.scenes).forEach((s, j) => {
      const base = `episodes[${i}].scenes[${j}]`;
      checkKeys(s, KNOWN_KEYS.scene, base, out);
      checkKeys(asRecord(s)?.heading, KNOWN_KEYS.heading, `${base}.heading`, out);
    });
  });
  asArray(root.adaptation_notes).forEach((n, i) => checkKeys(n, KNOWN_KEYS.adaptation_note, `adaptation_notes[${i}]`, out));
  checkKeys(root.quality_report, KNOWN_KEYS.quality_report, "quality_report", out);
  return out;
}

/**
 * Structural validation of a parsed Script object (spec §10).
 * Hard errors come from Zod (containers lenient, beats strict); every Zod issue maps to
 * one SCHEMA_ERROR{path,message}. Unknown container keys are non-blocking UNKNOWN_FIELD
 * warnings. (Referential/anchor/constraint checks live in Plan 3.)
 */
export function validateSchema(input: unknown): SchemaValidationResult {
  const errors: ValidationItem[] = [];
  const result = ScriptSchema.safeParse(input);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push({ path: formatPath(issue.path), code: "SCHEMA_ERROR", message: issue.message });
    }
  }
  const warnings = collectUnknownFieldWarnings(input);
  return { valid: errors.length === 0, errors, warnings };
}
