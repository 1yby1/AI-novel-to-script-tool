import { describe, it, expect } from "vitest";
import { checkConstraints, checkEpisodeConstraints } from "../../src/core/validate/constraints";
import { validScript } from "../helpers/valid-script";

const SHORT_DRAMA = {
  structure_unit: "episode",
  episode_count: 3,
  target_duration_seconds_per_episode: 120,
  opening_hook_required: true,
  cliffhanger_required: true,
  fidelity_level: "balanced",
} as const;

const cleanEpisode = () => ({ episode_no: 1, cliffhanger: "结尾悬念。", opening_hook: "强钩子。", estimated_duration_seconds: 120 });

describe("checkConstraints", () => {
  it("returns no warnings for a constraint-clean script", () => {
    expect(checkConstraints(validScript())).toEqual([]);
  });

  it("warns when episode count differs from episode_count", () => {
    const s = validScript();
    s.episodes = s.episodes.slice(0, 2);
    expect(checkConstraints(s).some((w) => w.code === "CONSTRAINT_WARNING" && w.path === "episodes")).toBe(true);
  });

  it("warns when a required cliffhanger is empty", () => {
    const s = validScript();
    s.episodes[1]!.cliffhanger = "   ";
    expect(checkConstraints(s).some((w) => w.path === "episodes[1].cliffhanger")).toBe(true);
  });

  it("warns when a required opening hook is empty on the first episode", () => {
    const s = validScript();
    s.episodes[0]!.opening_hook = "";
    expect(checkConstraints(s).some((w) => w.path === "episodes[0].opening_hook")).toBe(true);
  });

  it("warns when an episode duration deviates too far from target", () => {
    const s = validScript();
    s.episodes[0]!.estimated_duration_seconds = 600;
    expect(checkConstraints(s).some((w) => w.path === "episodes[0].estimated_duration_seconds")).toBe(true);
  });
});

describe("checkEpisodeConstraints", () => {
  it("returns no warnings for a clean episode", () => {
    expect(checkEpisodeConstraints(cleanEpisode(), SHORT_DRAMA, { isFirstEpisode: true })).toEqual([]);
  });

  it("warns on an empty required cliffhanger", () => {
    const w = checkEpisodeConstraints({ ...cleanEpisode(), cliffhanger: "   " }, SHORT_DRAMA, {});
    expect(w.some((item) => item.code === "CONSTRAINT_WARNING" && item.path.includes("cliffhanger"))).toBe(true);
  });

  it("warns on a duration far from target", () => {
    const w = checkEpisodeConstraints({ ...cleanEpisode(), estimated_duration_seconds: 600 }, SHORT_DRAMA, {});
    expect(w.some((item) => item.path.includes("estimated_duration_seconds"))).toBe(true);
  });

  it("flags an empty opening hook only for the first episode", () => {
    const ep = { ...cleanEpisode(), opening_hook: "" };
    expect(checkEpisodeConstraints(ep, SHORT_DRAMA, { isFirstEpisode: false }).some((w) => w.path.includes("opening_hook"))).toBe(false);
    expect(checkEpisodeConstraints(ep, SHORT_DRAMA, { isFirstEpisode: true }).some((w) => w.path.includes("opening_hook"))).toBe(true);
  });
});
