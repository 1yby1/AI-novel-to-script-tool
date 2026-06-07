import type { Script } from "../core/schema/script-schema";
import type { ValidationItem } from "../core/validate/schema-validate";
import type { PlanScenesResult } from "./provider";

/** Warning codes worth a retry (while attempts remain) before accepting a generated script. */
export const retryableGenerationWarnings = new Set(["WEAK_TRACEABILITY", "CONSTRAINT_WARNING"]);

function sceneRefs(scene: Script["episodes"][number]["scenes"][number]): Set<string> {
  return new Set([...scene.source_refs, ...scene.beats.flatMap((beat) => beat.source_refs)]);
}

function episodeIndexByNo(script: Script, episodeNo: number): number {
  return script.episodes.findIndex((episode) => episode.episode_no === episodeNo);
}

function sceneIndexByNo(script: Script, episodeIndex: number, sceneNo: number): number {
  return script.episodes[episodeIndex]?.scenes.findIndex((scene) => scene.scene_no === sceneNo) ?? -1;
}

/**
 * Check that the generated script honors the planning output (spec: planning → generation must
 * not drift). For each planned scene: the episode/scene must exist, its location must match, the
 * planned required characters must be present, and the planned source_refs must be covered by the
 * scene (scene-level or any beat). Returns PLAN_ADHERENCE findings with precise paths.
 */
export function checkGeneratedScriptAgainstPlan(script: Script, plan: PlanScenesResult): ValidationItem[] {
  const findings: ValidationItem[] = [];

  for (const plannedScene of plan.scene_plan) {
    const episodeIndex = episodeIndexByNo(script, plannedScene.episode_no);
    if (episodeIndex < 0) {
      findings.push({ path: "episodes", code: "PLAN_ADHERENCE", message: `缺少规划集：第 ${plannedScene.episode_no} 集` });
      continue;
    }

    const sceneIndex = sceneIndexByNo(script, episodeIndex, plannedScene.scene_no);
    if (sceneIndex < 0) {
      findings.push({
        path: `episodes[${episodeIndex}].scenes`,
        code: "PLAN_ADHERENCE",
        message: `缺少规划场景：第 ${plannedScene.episode_no} 集第 ${plannedScene.scene_no} 场（${plannedScene.purpose}）`,
      });
      continue;
    }

    const scene = script.episodes[episodeIndex]!.scenes[sceneIndex]!;
    if (scene.heading.location_id !== plannedScene.location_id) {
      findings.push({
        path: `episodes[${episodeIndex}].scenes[${sceneIndex}].heading.location_id`,
        code: "PLAN_ADHERENCE",
        message: `生成场景地点 ${scene.heading.location_id} 与规划地点 ${plannedScene.location_id} 不一致`,
      });
    }

    const missingCharacters = plannedScene.required_character_ids.filter((id) => !scene.present_character_ids.includes(id));
    if (missingCharacters.length > 0) {
      findings.push({
        path: `episodes[${episodeIndex}].scenes[${sceneIndex}].present_character_ids`,
        code: "PLAN_ADHERENCE",
        message: `生成场景缺少规划要求人物：${missingCharacters.join(", ")}`,
      });
    }

    const refs = sceneRefs(scene);
    const missingRefs = plannedScene.source_refs.filter((ref) => !refs.has(ref));
    if (missingRefs.length > 0) {
      findings.push({
        path: `episodes[${episodeIndex}].scenes[${sceneIndex}].source_refs`,
        code: "PLAN_ADHERENCE",
        message: `生成场景未覆盖规划 source_refs：${missingRefs.join(", ")}`,
      });
    }
  }

  return findings;
}

/** Keep only the warnings that should trigger a generation retry while attempts remain. */
export function retryableWarnings(warnings: ReadonlyArray<ValidationItem>): ValidationItem[] {
  return warnings.filter((warning) => retryableGenerationWarnings.has(warning.code));
}

/** Format validation/plan findings as `CODE @ path: message` lines for model feedback. */
export function formatGenerationFeedback(items: ReadonlyArray<ValidationItem>): string {
  return items.map((item) => `${item.code} @ ${item.path || "root"}: ${item.message}`).join("\n");
}
