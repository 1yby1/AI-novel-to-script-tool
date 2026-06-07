import { describe, it, expect } from "vitest";
import { buildAnalyzeMessages, buildPlanMessages, buildGenerateMessages } from "../../src/llm/prompts";
import type { AnalyzeResult, PlanScenesResult, SourceContext } from "../../src/llm/provider";

const source: SourceContext = {
  source_fingerprint: "fp",
  chapters: [{ id: "ch1", title: "归港", index: 1 }],
  source_paragraphs: [
    { id: "ch1_p1_aaaa1111", chapter_id: "ch1", paragraph_index: 1, text: "林深回到旧码头。", text_preview: "林深回到旧码头。", hash: "aaaa1111" },
  ],
};
const analysis: AnalyzeResult = {
  characters: [{ id: "char_lin", name: "林深", aliases: [], role: "protagonist", motivation: "", relationship_notes: "", source_refs: ["ch1_p1_aaaa1111"] }],
  locations: [{ id: "loc_dock", name: "旧码头", description: "", source_refs: ["ch1_p1_aaaa1111"] }],
  entity_catalog: [{ id: "char_lin", name: "林深" }, { id: "loc_dock", name: "旧码头" }],
  chapter_summaries: [{ chapter_id: "ch1", summary: "归港" }],
  key_events: [{ id: "evt_return", summary: "林深回到旧码头", involved_character_ids: ["char_lin"], location_id: "loc_dock", dramatic_function: "hook", source_refs: ["ch1_p1_aaaa1111"] }],
  conflicts: [{ id: "conf_truth", parties: ["林深"], surface_conflict: "追查真相", underlying_tension: "旧案被隐瞒", stakes: "真相会改变雾港", escalation: "线索指向仓库", source_refs: ["ch1_p1_aaaa1111"] }],
  relationship_edges: [],
  hook_candidates: [{ id: "hook_return", description: "死里逃生的人回到码头", why_it_hooks: "开场抛出生死谜题", suggested_episode_no: 1, source_refs: ["ch1_p1_aaaa1111"] }],
  adaptation_warnings: [],
};
const plan: PlanScenesResult = {
  episodes: [{
    episode_no: 1, title: "归来", opening_hook: "h", main_goal: "林深确认线索", core_conflict: "c", turning_point: "灯塔熄灭",
    cliffhanger: "cl", estimated_duration_seconds: 120, event_ids: ["evt_return"], source_refs: ["ch1_p1_aaaa1111"],
  }],
  scene_plan: [{
    episode_no: 1, scene_no: 1, location_id: "loc_dock", purpose: "建立钩子", conflict: "试探", emotional_shift: "压抑 -> 警觉",
    required_character_ids: ["char_lin"], event_ids: ["evt_return"], source_refs: ["ch1_p1_aaaa1111"], summary: "s",
  }],
  coverage: { covered_event_ids: ["evt_return"], omitted_event_ids: [], coverage_ratio: 1 },
  pacing_notes: [],
  adaptation_strategy: "balanced",
};

describe("prompts", () => {
  it("analyze injects the paragraph text and asks for v2 structured cards", () => {
    const msgs = buildAnalyzeMessages(source);
    const joined = msgs.map((m) => m.content).join("\n");
    expect(joined).toContain("ch1_p1_aaaa1111");
    expect(joined).toContain("林深回到旧码头");
    expect(msgs[0]!.role).toBe("system");
    expect(joined).toContain("dramatic_function");
    expect(joined).toContain("hook_candidates");
    expect(joined).toContain("relationship_edges");
  });
  it("plan injects the event catalog, hook candidates, and scene fields", () => {
    const joined = buildPlanMessages(source, analysis).map((m) => m.content).join("\n");
    expect(joined).toContain("char_lin");
    expect(joined).toContain("loc_dock");
    expect(joined).toContain("ch1_p1_aaaa1111");
    expect(joined).toContain("evt_return");
    expect(joined).toContain("hook_candidates");
    expect(joined).toContain("purpose");
    expect(joined).toContain("emotional_shift");
  });
  it("generate injects legal IDs and the v2 plan adherence guidance", () => {
    const joined = buildGenerateMessages(source, analysis, plan).map((m) => m.content).join("\n");
    expect(joined).toContain("ch1_p1_aaaa1111");
    expect(joined).toContain("char_lin");
    expect(joined).toContain("schema_version");
    expect(joined).toContain("main_goal");
    expect(joined).toContain("scene_plan");
    expect(joined).toContain("每个生成场景应对应一条 scene_plan");
    expect(joined).toContain("source_refs");
    expect(joined).toContain("purpose");
    expect(joined).toContain("emotional_shift");
  });
});
