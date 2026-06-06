import type { Script } from "../schema/script-schema";
import type { ValidationItem } from "./schema-validate";

export interface IntegrityResult {
  errors: ValidationItem[];
  warnings: ValidationItem[];
}

function duplicates<T>(items: ReadonlyArray<T>): T[] {
  const seen = new Set<T>();
  const dup = new Set<T>();
  for (const x of items) {
    if (seen.has(x)) dup.add(x);
    else seen.add(x);
  }
  return [...dup];
}

function isSequential(nums: ReadonlyArray<number>): boolean {
  return nums.every((n, i) => n === i + 1);
}

/**
 * Structural integrity beyond the Zod schema (spec §6 — IDs are system-owned & unique):
 * - error: duplicate paragraph/chapter/character/location IDs; duplicate episode/scene/beat numbers.
 * - warning: episode/scene/beat numbers that aren't a clean 1..N sequence (gaps/reordering are a
 *   quality signal, not necessarily invalid — so they don't hard-fail).
 */
export function checkIntegrity(script: Script): IntegrityResult {
  const errors: ValidationItem[] = [];
  const warnings: ValidationItem[] = [];

  const idGroups: Array<{ path: string; ids: string[] }> = [
    { path: "source_paragraphs", ids: script.source_paragraphs.map((p) => p.id) },
    { path: "source_chapters", ids: script.source_chapters.map((c) => c.id) },
    { path: "characters", ids: script.characters.map((c) => c.id) },
    { path: "locations", ids: script.locations.map((l) => l.id) },
  ];
  for (const g of idGroups) {
    for (const dup of duplicates(g.ids)) {
      errors.push({ path: g.path, code: "DUPLICATE_ID", message: `${g.path} 存在重复 id：${dup}` });
    }
  }

  const checkNums = (nums: number[], path: string, label: string): void => {
    for (const dup of duplicates(nums)) {
      errors.push({ path, code: "DUPLICATE_NUMBER", message: `${label}编号重复：${dup}` });
    }
    if (nums.length > 0 && !isSequential(nums)) {
      warnings.push({ path, code: "NON_SEQUENTIAL", message: `${label}编号建议为连续的 1..${nums.length}，实际：${nums.join(", ")}` });
    }
  };

  checkNums(script.episodes.map((e) => e.episode_no), "episodes", "集");
  script.episodes.forEach((ep, ei) => {
    checkNums(ep.scenes.map((s) => s.scene_no), `episodes[${ei}].scenes`, "场");
    ep.scenes.forEach((sc, si) => {
      checkNums(sc.beats.map((b) => b.beat_no), `episodes[${ei}].scenes[${si}].beats`, "beat");
    });
  });

  return { errors, warnings };
}
