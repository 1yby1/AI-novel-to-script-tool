import type { Script } from "../schema/script-schema";
import type { ValidationItem } from "./schema-validate";

/**
 * Internal referential integrity (spec §4.1–4.3, §4.5): every source_ref, location_id,
 * character_id and chapter_id resolves to a real entry within this script. Assumes the
 * input already passed structural validation (validateSchema).
 */
export function checkReferential(script: Script): ValidationItem[] {
  const errors: ValidationItem[] = [];
  const paragraphIds = new Set(script.source_paragraphs.map((p) => p.id));
  const chapterIds = new Set(script.source_chapters.map((c) => c.id));
  const characterIds = new Set(script.characters.map((c) => c.id));
  const locationIds = new Set(script.locations.map((l) => l.id));

  const checkRefs = (refs: ReadonlyArray<string>, basePath: string): void => {
    refs.forEach((ref, i) => {
      if (!paragraphIds.has(ref)) {
        errors.push({ path: `${basePath}[${i}]`, code: "INVALID_SOURCE_REF", message: `source_ref 不存在：${ref}` });
      }
    });
  };

  script.source_paragraphs.forEach((p, i) => {
    if (!chapterIds.has(p.chapter_id)) {
      errors.push({ path: `source_paragraphs[${i}].chapter_id`, code: "INVALID_CHAPTER_REF", message: `chapter_id 不存在：${p.chapter_id}` });
    }
  });

  script.characters.forEach((c, i) => checkRefs(c.source_refs, `characters[${i}].source_refs`));
  script.locations.forEach((l, i) => checkRefs(l.source_refs, `locations[${i}].source_refs`));
  script.adaptation_notes.forEach((n, i) => {
    if (n.source_refs) checkRefs(n.source_refs, `adaptation_notes[${i}].source_refs`);
  });

  script.episodes.forEach((ep, ei) => {
    ep.scenes.forEach((sc, si) => {
      const base = `episodes[${ei}].scenes[${si}]`;
      checkRefs(sc.source_refs, `${base}.source_refs`);
      if (!locationIds.has(sc.heading.location_id)) {
        errors.push({ path: `${base}.heading.location_id`, code: "INVALID_LOCATION_REF", message: `location_id 不存在：${sc.heading.location_id}` });
      }
      sc.present_character_ids.forEach((cid, ci) => {
        if (!characterIds.has(cid)) {
          errors.push({ path: `${base}.present_character_ids[${ci}]`, code: "INVALID_CHARACTER_REF", message: `character_id 不存在：${cid}` });
        }
      });
      sc.beats.forEach((b, bi) => {
        checkRefs(b.source_refs, `${base}.beats[${bi}].source_refs`);
        if (b.type === "dialogue" && !characterIds.has(b.character_id)) {
          errors.push({ path: `${base}.beats[${bi}].character_id`, code: "INVALID_CHARACTER_REF", message: `character_id 不存在：${b.character_id}` });
        }
      });
    });
  });

  return errors;
}
