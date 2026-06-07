import { describe, it, expect } from "vitest";
import { LiveLLMProvider } from "../../src/llm/live-provider";
import type { CompleteFn } from "../../src/llm/json-llm";
import type { AnalyzeInput, AnalyzeResult, GenerateInput, PlanInput, PlanScenesResult } from "../../src/llm/provider";

const source = {
  source_fingerprint: "fp",
  chapters: [{ id: "ch1", title: "归港", index: 1 }],
  source_paragraphs: [
    { id: "ch1_p1_aaaa1111", chapter_id: "ch1", paragraph_index: 1, text: "林深回到旧码头。", text_preview: "林深回到旧码头。", hash: "aaaa1111" },
  ],
};

function fixedComplete(json: string): CompleteFn {
  return async () => json;
}

const v2Analysis: AnalyzeResult = {
  characters: [{ id: "char_lin", name: "林深", aliases: [], role: "protagonist", motivation: "", relationship_notes: "", source_refs: ["ch1_p1_aaaa1111"] }],
  locations: [{ id: "loc_dock", name: "旧码头", description: "", source_refs: ["ch1_p1_aaaa1111"] }],
  entity_catalog: [{ id: "char_lin", name: "林深" }, { id: "loc_dock", name: "旧码头" }],
  chapter_summaries: [{ chapter_id: "ch1", summary: "归港" }],
  key_events: [{ id: "evt_return", summary: "归港", involved_character_ids: ["char_lin"], location_id: "loc_dock", dramatic_function: "hook", source_refs: ["ch1_p1_aaaa1111"] }],
  conflicts: [],
  relationship_edges: [],
  hook_candidates: [],
  adaptation_warnings: [],
};

describe("LiveLLMProvider.analyze", () => {
  it("maps names to system IDs and builds structured dramaturgy cards", async () => {
    const json = JSON.stringify({
      characters: [{ name: "林深", role: "protagonist", source_refs: ["ch1_p1_aaaa1111", "ch9_bad"] }],
      locations: [{ name: "旧码头", source_refs: ["ch1_p1_aaaa1111"] }],
      chapter_summaries: [{ chapter_id: "ch1", summary: "归港" }],
      key_events: [{
        id: "evt_return",
        summary: "林深回到旧码头",
        involved_character_names: ["林深"],
        location_name: "旧码头",
        dramatic_function: "hook",
        source_refs: ["ch1_p1_aaaa1111", "bad_ref"],
      }],
      conflicts: [{
        id: "conf_truth",
        parties: ["林深"],
        surface_conflict: "追查真相",
        underlying_tension: "真相被遮掩",
        stakes: "旧案会牵动雾港",
        escalation: "线索指向仓库",
        source_refs: ["ch1_p1_aaaa1111"],
      }],
      relationship_edges: [],
      hook_candidates: [{
        id: "hook_return",
        description: "死里逃生的人归港",
        why_it_hooks: "开场抛出生死谜题",
        suggested_episode_no: 1,
        source_refs: ["ch1_p1_aaaa1111"],
      }],
      adaptation_warnings: ["原文较短，需要强化冲突。"],
    });
    const provider = new LiveLLMProvider(fixedComplete(json));
    const r = await provider.analyze(source as AnalyzeInput);
    expect(r.characters[0]!.id).toMatch(/^char_/);
    expect(r.locations[0]!.id).toMatch(/^loc_/);
    expect(r.entity_catalog.length).toBe(2);
    expect(r.characters[0]!.source_refs).toEqual(["ch1_p1_aaaa1111"]);
    expect(r.key_events[0]!.involved_character_ids).toEqual([r.characters[0]!.id]);
    expect(r.key_events[0]!.location_id).toBe(r.locations[0]!.id);
    expect(r.key_events[0]!.source_refs).toEqual(["ch1_p1_aaaa1111"]); // bad_ref filtered out
    expect(r.conflicts[0]!.id).toBe("conf_truth");
    expect(r.hook_candidates[0]!.source_refs).toEqual(["ch1_p1_aaaa1111"]);
    expect(r.adaptation_warnings).toEqual(["原文较短，需要强化冲突。"]);
  });

  it("throws when given no source paragraphs", async () => {
    const provider = new LiveLLMProvider(fixedComplete("{}"));
    await expect(provider.analyze({ source_fingerprint: "fp" } as AnalyzeInput)).rejects.toThrow();
  });

  it("de-duplicates colliding event ids so coverage/links stay unambiguous", async () => {
    const json = JSON.stringify({
      characters: [{ name: "林深" }],
      locations: [],
      chapter_summaries: [],
      key_events: [
        { id: "evt_x", summary: "a", involved_character_names: [], location_name: null, dramatic_function: "hook", source_refs: [] },
        { id: "evt_x", summary: "b", involved_character_names: [], location_name: null, dramatic_function: "setup", source_refs: [] },
      ],
      conflicts: [],
      relationship_edges: [],
      hook_candidates: [],
      adaptation_warnings: [],
    });
    const r = await new LiveLLMProvider(fixedComplete(json)).analyze(source as AnalyzeInput);
    const ids = r.key_events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("LiveLLMProvider.generateScript", () => {
  const analysis = v2Analysis;
  const plan: PlanScenesResult = {
    episodes: [],
    scene_plan: [],
    coverage: { covered_event_ids: [], omitted_event_ids: [], coverage_ratio: 1 },
    pacing_notes: [],
    adaptation_strategy: "",
  };
  const creativeJson = JSON.stringify({
    episodes: [{
      episode_no: 1, title: "归来", opening_hook: "他回来了", core_conflict: "真相", cliffhanger: "灯灭了", estimated_duration_seconds: 120,
      scenes: [{
        scene_no: 1,
        heading: { int_ext: "EXT", location_id: "loc_dock", time_of_day: "NIGHT" },
        present_character_ids: ["char_lin"],
        summary: "登岸",
        beats: [{ beat_no: 1, type: "action", source_refs: ["ch1_p1_aaaa1111"], description: "林深踏上栈桥。" }],
        source_refs: ["ch1_p1_aaaa1111"],
      }],
    }],
    adaptation_notes: [{ type: "merge", description: "合并船员", source_refs: ["ch1_p1_aaaa1111"] }],
  });

  it("assembles a schema-valid Script and emits YAML", async () => {
    const provider = new LiveLLMProvider(fixedComplete(creativeJson));
    const out = await provider.generateScript({ ...source, analysis, plan, created_at: "2026-06-06T00:00:00Z", model: "test-model" } as GenerateInput);
    expect(out.script_json.schema_version).toBe("1.0");
    expect(out.script_json.metadata.generator.mode).toBe("live");
    expect(out.script_json.metadata.source_fingerprint).toBe("fp");
    expect(out.script_json.episodes[0]!.scenes[0]!.beats[0]!.type).toBe("action");
    expect(out.script_json.source_paragraphs[0]!.id).toBe("ch1_p1_aaaa1111");
    expect(out.script_yaml).toContain("schema_version");
  });

  it("retries when the first creative output is structurally invalid", async () => {
    let i = 0;
    const responses = ['{"episodes":[{"episode_no":1}],"adaptation_notes":[]}', creativeJson];
    const complete: CompleteFn = async () => responses[Math.min(i++, responses.length - 1)]!;
    const provider = new LiveLLMProvider(complete, 2);
    const out = await provider.generateScript({ ...source, analysis, plan } as GenerateInput);
    expect(out.script_json.episodes[0]!.title).toBe("归来");
    expect(i).toBeGreaterThanOrEqual(2);
  });

  it("requires analysis and plan", async () => {
    const provider = new LiveLLMProvider(fixedComplete(creativeJson));
    await expect(provider.generateScript({ ...source } as GenerateInput)).rejects.toThrow();
  });

  it("retries and throws when the model keeps returning empty episodes", async () => {
    const provider = new LiveLLMProvider(fixedComplete('{"episodes":[],"adaptation_notes":[]}'), 1);
    await expect(provider.generateScript({ ...source, analysis, plan } as GenerateInput)).rejects.toThrow();
  });

  it("retries when full validation surfaces an untraceable/invalid reference, then accepts a clean script", async () => {
    let i = 0;
    const bad = JSON.stringify({
      episodes: [{
        episode_no: 1, title: "坏引用", opening_hook: "他回来了", core_conflict: "真相", cliffhanger: "灯灭", estimated_duration_seconds: 120,
        scenes: [{
          scene_no: 1,
          heading: { int_ext: "EXT", location_id: "loc_dock", time_of_day: "NIGHT" },
          present_character_ids: ["char_lin"],
          summary: "登岸",
          beats: [{ beat_no: 1, type: "action", source_refs: ["bad_ref"], description: "林深踏上栈桥。" }],
          source_refs: ["bad_ref"],
        }],
      }],
      adaptation_notes: [],
    });
    const responses = [bad, creativeJson];
    const complete: CompleteFn = async () => responses[Math.min(i++, responses.length - 1)]!;
    const provider = new LiveLLMProvider(complete, 2);
    const out = await provider.generateScript({ ...source, analysis, plan } as GenerateInput);
    expect(out.script_json.episodes[0]!.title).toBe("归来");
    expect(i).toBeGreaterThanOrEqual(2);
  });

  it("retries when generated scenes drift from the plan", async () => {
    let i = 0;
    const planned: PlanScenesResult = {
      episodes: [{ episode_no: 1, title: "归来", opening_hook: "他回来了", main_goal: "确认线索", core_conflict: "真相", turning_point: "灯灭", cliffhanger: "灯灭", estimated_duration_seconds: 120, event_ids: ["evt_return"], source_refs: ["ch1_p1_aaaa1111"] }],
      scene_plan: [{ episode_no: 1, scene_no: 1, location_id: "loc_dock", purpose: "建立归港钩子", conflict: "试探", emotional_shift: "平静 -> 警觉", required_character_ids: ["char_lin"], event_ids: ["evt_return"], source_refs: ["ch1_p1_aaaa1111"], summary: "登岸" }],
      coverage: { covered_event_ids: ["evt_return"], omitted_event_ids: [], coverage_ratio: 1 },
      pacing_notes: [],
      adaptation_strategy: "",
    };
    const bad = JSON.stringify({
      episodes: [{
        episode_no: 1, title: "偏离规划", opening_hook: "他回来了", core_conflict: "真相", cliffhanger: "灯灭", estimated_duration_seconds: 120,
        scenes: [{
          scene_no: 1,
          heading: { int_ext: "EXT", location_id: "loc_dock", time_of_day: "NIGHT" },
          present_character_ids: [],
          summary: "登岸",
          beats: [{ beat_no: 1, type: "action", source_refs: [], description: "林深踏上栈桥。" }],
          source_refs: [],
        }],
      }],
      adaptation_notes: [],
    });
    const responses = [bad, creativeJson];
    const complete: CompleteFn = async () => responses[Math.min(i++, responses.length - 1)]!;
    const provider = new LiveLLMProvider(complete, 2);
    const out = await provider.generateScript({ ...source, analysis, plan: planned } as GenerateInput);
    expect(out.script_json.episodes[0]!.title).toBe("归来");
    expect(i).toBeGreaterThanOrEqual(2);
  });

  it("retries weak-traceability warnings while attempts remain", async () => {
    let i = 0;
    const weak = JSON.stringify({
      episodes: [{
        episode_no: 1, title: "弱溯源", opening_hook: "他回来了", core_conflict: "真相", cliffhanger: "灯灭", estimated_duration_seconds: 120,
        scenes: [{
          scene_no: 1,
          heading: { int_ext: "EXT", location_id: "loc_dock", time_of_day: "NIGHT" },
          present_character_ids: ["char_lin"],
          summary: "登岸",
          beats: [{ beat_no: 1, type: "action", source_refs: [], description: "林深踏上栈桥。" }],
          source_refs: [],
        }],
      }],
      adaptation_notes: [],
    });
    const responses = [weak, creativeJson];
    const complete: CompleteFn = async () => responses[Math.min(i++, responses.length - 1)]!;
    const provider = new LiveLLMProvider(complete, 2);
    const out = await provider.generateScript({ ...source, analysis, plan } as GenerateInput);
    expect(out.script_json.episodes[0]!.title).toBe("归来");
    expect(i).toBeGreaterThanOrEqual(2);
  });
});

describe("LiveLLMProvider.planScenes", () => {
  it("validates, recomputes coverage, and returns a consistent v2 plan", async () => {
    const planJson = JSON.stringify({
      episodes: [{
        episode_no: 1,
        title: "归来",
        opening_hook: "h",
        main_goal: "林深确认线索",
        core_conflict: "c",
        turning_point: "灯塔熄灭",
        cliffhanger: "cl",
        estimated_duration_seconds: 120,
        event_ids: ["evt_return"],
        source_refs: ["ch1_p1_aaaa1111"],
      }],
      scene_plan: [{
        episode_no: 1,
        scene_no: 1,
        location_id: "loc_dock",
        purpose: "建立钩子",
        conflict: "试探",
        emotional_shift: "压抑 -> 警觉",
        required_character_ids: ["char_lin"],
        event_ids: ["evt_return"],
        source_refs: ["ch1_p1_aaaa1111"],
        summary: "s",
      }],
      pacing_notes: [],
      adaptation_strategy: "balanced",
    });
    const provider = new LiveLLMProvider(fixedComplete(planJson));
    const r = await provider.planScenes({ ...source, analysis: v2Analysis } as PlanInput);
    expect(r.coverage.coverage_ratio).toBe(1);
    expect(r.scene_plan[0]!.purpose).toBe("建立钩子");
  });

  it("retries when the plan references unknown IDs, then throws", async () => {
    const badPlan = JSON.stringify({
      episodes: [],
      scene_plan: [{
        episode_no: 1, scene_no: 1, location_id: "loc_ghost", purpose: "x", conflict: "x", emotional_shift: "x",
        required_character_ids: [], event_ids: [], source_refs: [], summary: "x",
      }],
      pacing_notes: [], adaptation_strategy: "x",
    });
    const provider = new LiveLLMProvider(fixedComplete(badPlan), 1);
    await expect(provider.planScenes({ ...source, analysis: v2Analysis } as PlanInput)).rejects.toThrow(/loc_ghost|不合法/);
  });
});
