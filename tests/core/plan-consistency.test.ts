import { describe, expect, it } from "vitest";
import { normalizePlanCoverage, findPlanConsistencyErrors } from "../../src/llm/plan-consistency";
import type { AnalyzeResult, PlanScenesResult, SourceContext } from "../../src/llm/provider";

const source: SourceContext = {
  source_fingerprint: "fp",
  source_paragraphs: [
    { id: "ch1_p1_a", chapter_id: "ch1", paragraph_index: 1, text: "a", text_preview: "a", hash: "a" },
    { id: "ch1_p2_b", chapter_id: "ch1", paragraph_index: 2, text: "b", text_preview: "b", hash: "b" },
  ],
};

const analysis: AnalyzeResult = {
  characters: [{ id: "char_lin", name: "林深", aliases: [], role: "protagonist", motivation: "", relationship_notes: "", source_refs: ["ch1_p1_a"] }],
  locations: [{ id: "loc_dock", name: "旧码头", description: "", source_refs: ["ch1_p1_a"] }],
  entity_catalog: [{ id: "char_lin", name: "林深" }, { id: "loc_dock", name: "旧码头" }],
  chapter_summaries: [{ chapter_id: "ch1", summary: "归港" }],
  key_events: [
    { id: "evt_1", summary: "归港", involved_character_ids: ["char_lin"], location_id: "loc_dock", dramatic_function: "hook", source_refs: ["ch1_p1_a"] },
    { id: "evt_2", summary: "怀表", involved_character_ids: ["char_lin"], location_id: "loc_dock", dramatic_function: "setup", source_refs: ["ch1_p2_b"] },
  ],
  conflicts: [],
  relationship_edges: [],
  hook_candidates: [],
  adaptation_warnings: [],
};

const plan: PlanScenesResult = {
  episodes: [{
    episode_no: 1,
    title: "归来",
    opening_hook: "他回来了",
    main_goal: "找到线索",
    core_conflict: "追查",
    turning_point: "灯灭",
    cliffhanger: "怀表出现",
    estimated_duration_seconds: 120,
    event_ids: ["evt_1"],
    source_refs: ["ch1_p1_a"],
  }],
  scene_plan: [{
    episode_no: 1,
    scene_no: 1,
    location_id: "loc_dock",
    purpose: "建立钩子",
    conflict: "想查与被试探",
    emotional_shift: "压抑 -> 警觉",
    required_character_ids: ["char_lin"],
    event_ids: ["evt_1"],
    source_refs: ["ch1_p1_a"],
    summary: "林深归港。",
  }],
  coverage: { covered_event_ids: [], omitted_event_ids: [], coverage_ratio: 0 },
  pacing_notes: [],
  adaptation_strategy: "balanced",
};

describe("normalizePlanCoverage", () => {
  it("recomputes coverage from episode and scene event_ids", () => {
    expect(normalizePlanCoverage(plan, analysis)).toEqual({
      covered_event_ids: ["evt_1"],
      omitted_event_ids: ["evt_2"],
      coverage_ratio: 0.5,
    });
  });
});

describe("findPlanConsistencyErrors", () => {
  it("accepts a plan that uses known event, character, location, and source IDs", () => {
    expect(findPlanConsistencyErrors(plan, analysis, source)).toEqual([]);
  });

  it("reports invalid IDs with useful paths", () => {
    const broken: PlanScenesResult = {
      ...plan,
      scene_plan: [{
        ...plan.scene_plan[0]!,
        location_id: "loc_missing",
        required_character_ids: ["char_missing"],
        event_ids: ["evt_missing"],
        source_refs: ["ch9_bad"],
      }],
    };
    expect(findPlanConsistencyErrors(broken, analysis, source)).toEqual([
      "scene_plan[0].location_id invalid: loc_missing",
      "scene_plan[0].required_character_ids[0] invalid: char_missing",
      "scene_plan[0].event_ids[0] invalid: evt_missing",
      "scene_plan[0].source_refs[0] invalid: ch9_bad",
    ]);
  });
});
