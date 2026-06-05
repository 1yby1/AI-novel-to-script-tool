import { describe, it, expect } from "vitest";
import { checkConstraints } from "../../src/core/validate/constraints";
import { validScript } from "../helpers/valid-script";

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
