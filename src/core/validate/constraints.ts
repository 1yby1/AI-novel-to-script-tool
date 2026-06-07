import type { Script, AdaptationConstraints } from "../schema/script-schema";
import type { ValidationItem } from "./schema-validate";

const DURATION_TOLERANCE = 0.5; // allow ±50% of target before warning

/** Fields a per-episode constraint check needs (a full Script episode satisfies this). */
type EpisodeConstraintInput = Pick<
  Script["episodes"][number],
  "episode_no" | "cliffhanger" | "opening_hook" | "estimated_duration_seconds"
>;

/**
 * Per-episode subset of the adaptation constraints: duration proximity, required cliffhanger, and —
 * for the first episode only — a required opening hook. Shared by the whole-script `checkConstraints`
 * and the per-episode live-generation retry gate so the two stay in lockstep. `episode_count` is a
 * whole-script concern and is intentionally NOT checked here.
 */
export function checkEpisodeConstraints(
  episode: EpisodeConstraintInput,
  constraints: AdaptationConstraints,
  options: { isFirstEpisode?: boolean; episodeIndex?: number } = {},
): ValidationItem[] {
  const out: ValidationItem[] = [];
  const i = options.episodeIndex ?? 0;
  const target = constraints.target_duration_seconds_per_episode;
  if (Math.abs(episode.estimated_duration_seconds - target) > target * DURATION_TOLERANCE) {
    out.push({ path: `episodes[${i}].estimated_duration_seconds`, code: "CONSTRAINT_WARNING", message: `第 ${episode.episode_no} 集时长 ${episode.estimated_duration_seconds}s 偏离目标 ${target}s 过多` });
  }
  if (constraints.cliffhanger_required && episode.cliffhanger.trim() === "") {
    out.push({ path: `episodes[${i}].cliffhanger`, code: "CONSTRAINT_WARNING", message: `约束要求结尾悬念，但第 ${episode.episode_no} 集 cliffhanger 为空` });
  }
  if (options.isFirstEpisode && constraints.opening_hook_required && episode.opening_hook.trim() === "") {
    out.push({ path: `episodes[${i}].opening_hook`, code: "CONSTRAINT_WARNING", message: "约束要求开场钩子，但首集 opening_hook 为空" });
  }
  return out;
}

/**
 * Check the script against its adaptation_constraints (spec §10). Returns CONSTRAINT_WARNING
 * items; the user-edit re-validation path may upgrade these to hard CONSTRAINT_VIOLATION.
 * Checks: episode count, per-episode duration proximity, opening hook (first episode) and
 * cliffhanger (each episode) when required.
 */
export function checkConstraints(script: Script): ValidationItem[] {
  const c = script.adaptation_constraints;
  const out: ValidationItem[] = [];

  if (script.episodes.length !== c.episode_count) {
    out.push({ path: "episodes", code: "CONSTRAINT_WARNING", message: `集数 ${script.episodes.length} 与约束 episode_count=${c.episode_count} 不一致` });
  }

  script.episodes.forEach((ep, i) => {
    out.push(...checkEpisodeConstraints(ep, c, { isFirstEpisode: i === 0, episodeIndex: i }));
  });

  return out;
}
