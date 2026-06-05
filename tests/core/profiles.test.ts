import { describe, it, expect } from "vitest";
import { getProfileConstraints } from "../../src/core/schema/profiles";
import { ADAPTATION_PROFILES, AdaptationConstraintsSchema } from "../../src/core/schema/script-schema";

describe("getProfileConstraints", () => {
  it("returns the short_drama preset (3 episodes x 120s, hook+cliffhanger required)", () => {
    expect(getProfileConstraints("short_drama")).toEqual({
      structure_unit: "episode",
      episode_count: 3,
      target_duration_seconds_per_episode: 120,
      opening_hook_required: true,
      cliffhanger_required: true,
      fidelity_level: "balanced",
    });
  });

  it("uses act structure for film", () => {
    expect(getProfileConstraints("film").structure_unit).toBe("act");
  });

  it("returns constraints that satisfy AdaptationConstraintsSchema for every profile", () => {
    for (const p of ADAPTATION_PROFILES) {
      expect(AdaptationConstraintsSchema.safeParse(getProfileConstraints(p)).success).toBe(true);
    }
  });

  it("returns a fresh copy each call (no shared mutable state)", () => {
    const a = getProfileConstraints("short_drama");
    a.episode_count = 99;
    expect(getProfileConstraints("short_drama").episode_count).toBe(3);
  });
});
