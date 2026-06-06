import type { Script } from "../schema/script-schema";

export interface SourceRefRepairResult {
  script: Script;
  repairedRefs: string[];
}

function filterRefs(refs: string[], validIds: ReadonlySet<string>, repaired: Set<string>): string[] {
  return refs.filter((ref) => {
    const keep = validIds.has(ref);
    if (!keep) repaired.add(ref);
    return keep;
  });
}

/**
 * Generation path repair: strip illegal source_refs before final validation while
 * recording what was removed. This keeps fixture/live generation usable without
 * hiding model mistakes from the quality report.
 */
export function stripInvalidSourceRefs(script: Script, validParagraphIds: ReadonlyArray<string>): SourceRefRepairResult {
  const validIds = new Set(validParagraphIds);
  const repaired = new Set<string>();
  const next = structuredClone(script) as Script;

  next.characters.forEach((c) => { c.source_refs = filterRefs(c.source_refs, validIds, repaired); });
  next.locations.forEach((l) => { l.source_refs = filterRefs(l.source_refs, validIds, repaired); });
  next.adaptation_notes.forEach((n) => {
    if (n.source_refs) n.source_refs = filterRefs(n.source_refs, validIds, repaired);
  });
  next.episodes.forEach((ep) =>
    ep.scenes.forEach((sc) => {
      sc.source_refs = filterRefs(sc.source_refs, validIds, repaired);
      sc.beats.forEach((b) => { b.source_refs = filterRefs(b.source_refs, validIds, repaired); });
    }),
  );

  return { script: next, repairedRefs: [...repaired] };
}
