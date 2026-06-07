import type { AnalyzeResult, PlanCoverage, PlanScenesResult, SourceContext } from "./provider";

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * Recompute event coverage deterministically from the plan's episode + scene `event_ids`
 * against the analysis key-events (never trust a model-supplied coverage).
 */
export function normalizePlanCoverage(plan: PlanScenesResult, analysis: AnalyzeResult): PlanCoverage {
  const allEventIds = analysis.key_events.map((event) => event.id);
  const used = uniqueSorted(
    [
      ...plan.episodes.flatMap((episode) => episode.event_ids),
      ...plan.scene_plan.flatMap((scene) => scene.event_ids),
    ].filter((id) => allEventIds.includes(id)),
  );
  const omitted = allEventIds.filter((id) => !used.includes(id));
  const ratio = allEventIds.length === 0 ? 1 : used.length / allEventIds.length;
  return {
    covered_event_ids: used,
    omitted_event_ids: omitted,
    coverage_ratio: Number(ratio.toFixed(4)),
  };
}

/**
 * Anti-hallucination for the plan stage: every event_id / required_character_id / location_id /
 * source_ref a plan references must exist in the analysis + parsed source. Returns human-readable
 * error strings with paths (used by the live planScenes retry loop).
 */
export function findPlanConsistencyErrors(
  plan: PlanScenesResult,
  analysis: AnalyzeResult,
  source: SourceContext,
): string[] {
  const errors: string[] = [];
  const eventIds = new Set(analysis.key_events.map((event) => event.id));
  const characterIds = new Set(analysis.characters.map((character) => character.id));
  const locationIds = new Set(analysis.locations.map((location) => location.id));
  const paragraphIds = new Set((source.source_paragraphs ?? []).map((paragraph) => paragraph.id));

  const checkRefs = (refs: string[], valid: ReadonlySet<string>, path: string): void => {
    refs.forEach((ref, index) => {
      if (!valid.has(ref)) errors.push(`${path}[${index}] invalid: ${ref}`);
    });
  };

  plan.episodes.forEach((episode, episodeIndex) => {
    checkRefs(episode.event_ids, eventIds, `episodes[${episodeIndex}].event_ids`);
    checkRefs(episode.source_refs, paragraphIds, `episodes[${episodeIndex}].source_refs`);
  });

  plan.scene_plan.forEach((scene, sceneIndex) => {
    if (!locationIds.has(scene.location_id)) {
      errors.push(`scene_plan[${sceneIndex}].location_id invalid: ${scene.location_id}`);
    }
    checkRefs(scene.required_character_ids, characterIds, `scene_plan[${sceneIndex}].required_character_ids`);
    checkRefs(scene.event_ids, eventIds, `scene_plan[${sceneIndex}].event_ids`);
    checkRefs(scene.source_refs, paragraphIds, `scene_plan[${sceneIndex}].source_refs`);
  });

  return errors;
}
