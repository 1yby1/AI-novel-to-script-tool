import { describe, it, expect } from "vitest";
import { RawAnalyzeSchema, PlanSchema } from "../../src/llm/output-schemas";

describe("RawAnalyzeSchema", () => {
  it("accepts entities without IDs (system assigns IDs)", () => {
    const r = RawAnalyzeSchema.safeParse({
      characters: [{ name: "林深", role: "protagonist" }],
      locations: [{ name: "旧码头" }],
      chapter_summaries: [{ chapter_id: "ch1", summary: "x" }],
      key_events: ["a"],
      conflicts: ["b"],
    });
    expect(r.success).toBe(true);
  });
  it("rejects a character without a name", () => {
    const r = RawAnalyzeSchema.safeParse({
      characters: [{ role: "minor" }],
      locations: [],
      chapter_summaries: [],
      key_events: [],
      conflicts: [],
    });
    expect(r.success).toBe(false);
  });
});

describe("PlanSchema", () => {
  it("accepts a minimal valid plan", () => {
    const r = PlanSchema.safeParse({
      episodes: [{ episode_no: 1, title: "t", opening_hook: "h", core_conflict: "c", cliffhanger: "cl", estimated_duration_seconds: 120, scene_refs: ["s1"] }],
      scene_plan: [{ episode_no: 1, scene_no: 1, location_id: "loc_x", summary: "s" }],
      pacing_notes: [],
      adaptation_strategy: "balanced",
    });
    expect(r.success).toBe(true);
  });
  it("rejects a non-integer episode_no", () => {
    const r = PlanSchema.safeParse({ episodes: [{ episode_no: 1.5, title: "t", opening_hook: "h", core_conflict: "c", cliffhanger: "cl", estimated_duration_seconds: 120, scene_refs: [] }], scene_plan: [], pacing_notes: [], adaptation_strategy: "x" });
    expect(r.success).toBe(false);
  });
});
