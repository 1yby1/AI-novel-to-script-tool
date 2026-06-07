import { describe, it, expect } from "vitest";
import { RawAnalyzeSchema, PlanSchema } from "../../src/llm/output-schemas";

describe("RawAnalyzeSchema", () => {
  it("accepts structured dramaturgy cards without system IDs", () => {
    const r = RawAnalyzeSchema.safeParse({
      characters: [{ name: "林深", role: "protagonist", source_refs: ["ch1_p1_a"] }],
      locations: [{ name: "旧码头", source_refs: ["ch1_p1_a"] }],
      chapter_summaries: [{ chapter_id: "ch1", summary: "归港" }],
      key_events: [{
        id: "evt_1",
        summary: "林深归港",
        involved_character_names: ["林深"],
        location_name: "旧码头",
        dramatic_function: "hook",
        source_refs: ["ch1_p1_a"],
      }],
      conflicts: [{
        id: "conf_1",
        parties: ["林深", "周砚"],
        surface_conflict: "追查与阻挠",
        underlying_tension: "旧案真相会动摇雾港",
        stakes: "公开真相可能毁掉雾港",
        escalation: "从怀表线索升级到仓库对峙",
        source_refs: ["ch1_p1_a"],
      }],
      relationship_edges: [{
        from_character_name: "林深",
        to_character_name: "周砚",
        relation: "追查者与阻挠者",
        tension: "真相与遮掩",
        source_refs: ["ch1_p1_a"],
      }],
      hook_candidates: [{
        id: "hook_1",
        description: "死里逃生的人回到旧码头",
        why_it_hooks: "开场即抛出生死谜题",
        suggested_episode_no: 1,
        source_refs: ["ch1_p1_a"],
      }],
      adaptation_warnings: ["原文较短，需要压缩成强冲突场景。"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an event with an unsupported dramatic function", () => {
    const r = RawAnalyzeSchema.safeParse({
      characters: [],
      locations: [],
      chapter_summaries: [],
      key_events: [{
        id: "evt_1",
        summary: "x",
        involved_character_names: [],
        location_name: null,
        dramatic_function: "montage",
        source_refs: [],
      }],
      conflicts: [],
    });
    expect(r.success).toBe(false);
  });
});

describe("PlanSchema", () => {
  it("accepts a v2 plan with episode goals and scene purposes", () => {
    const r = PlanSchema.safeParse({
      episodes: [{
        episode_no: 1,
        title: "归来",
        opening_hook: "他回来了",
        main_goal: "林深确认苏晚掌握线索",
        core_conflict: "追查与隐瞒",
        turning_point: "灯塔熄灭",
        cliffhanger: "怀表停在沉船时刻",
        estimated_duration_seconds: 120,
        event_ids: ["evt_1"],
        source_refs: ["ch1_p1_a"],
      }],
      scene_plan: [{
        episode_no: 1,
        scene_no: 1,
        location_id: "loc_dock",
        purpose: "建立归港钩子",
        conflict: "林深想查，苏晚先试探",
        emotional_shift: "压抑 -> 警觉",
        required_character_ids: ["char_lin"],
        event_ids: ["evt_1"],
        source_refs: ["ch1_p1_a"],
        summary: "林深回到旧码头。",
      }],
      coverage: { covered_event_ids: ["evt_1"], omitted_event_ids: [], coverage_ratio: 1 },
      pacing_notes: [],
      adaptation_strategy: "balanced",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a scene without a purpose", () => {
    const r = PlanSchema.safeParse({
      episodes: [],
      scene_plan: [{
        episode_no: 1,
        scene_no: 1,
        location_id: "loc_dock",
        conflict: "x",
        emotional_shift: "x",
        required_character_ids: [],
        event_ids: [],
        source_refs: [],
        summary: "x",
      }],
      pacing_notes: [],
      adaptation_strategy: "x",
    });
    expect(r.success).toBe(false);
  });
});
