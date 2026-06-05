import type { Script } from "../schema/script-schema";
import type { ValidationItem } from "./schema-validate";

const DURATION_TOLERANCE = 0.5; // allow ±50% of target before warning

/**
 * Check the script against its adaptation_constraints (spec §10). Returns CONSTRAINT_WARNING
 * items; the user-edit re-validation path may upgrade these to hard CONSTRAINT_VIOLATION.
 * Checks: episode count, per-episode duration proximity, opening hook (first episode) and
 * cliffhanger (each episode) when required.
 */
export function checkConstraints(script: Script): ValidationItem[] {
  const out: ValidationItem[] = [];
  const c = script.adaptation_constraints;

  if (script.episodes.length !== c.episode_count) {
    out.push({ path: "episodes", code: "CONSTRAINT_WARNING", message: `集数 ${script.episodes.length} 与约束 episode_count=${c.episode_count} 不一致` });
  }

  script.episodes.forEach((ep, i) => {
    const target = c.target_duration_seconds_per_episode;
    if (Math.abs(ep.estimated_duration_seconds - target) > target * DURATION_TOLERANCE) {
      out.push({ path: `episodes[${i}].estimated_duration_seconds`, code: "CONSTRAINT_WARNING", message: `第 ${ep.episode_no} 集时长 ${ep.estimated_duration_seconds}s 偏离目标 ${target}s 过多` });
    }
    if (c.cliffhanger_required && ep.cliffhanger.trim() === "") {
      out.push({ path: `episodes[${i}].cliffhanger`, code: "CONSTRAINT_WARNING", message: `约束要求结尾悬念，但第 ${ep.episode_no} 集 cliffhanger 为空` });
    }
  });

  if (c.opening_hook_required) {
    const first = script.episodes[0];
    if (first && first.opening_hook.trim() === "") {
      out.push({ path: "episodes[0].opening_hook", code: "CONSTRAINT_WARNING", message: "约束要求开场钩子，但首集 opening_hook 为空" });
    }
  }

  return out;
}
