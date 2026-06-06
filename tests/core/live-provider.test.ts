import { describe, it, expect } from "vitest";
import { LiveLLMProvider } from "../../src/llm/live-provider";
import type { CompleteFn } from "../../src/llm/json-llm";
import type { AnalyzeInput, GenerateInput, PlanInput } from "../../src/llm/provider";

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

describe("LiveLLMProvider.analyze", () => {
  it("assigns deterministic entity IDs and builds the catalog", async () => {
    const json = JSON.stringify({
      characters: [{ name: "林深", role: "protagonist", source_refs: ["ch1_p1_aaaa1111", "ch9_bad"] }],
      locations: [{ name: "旧码头" }],
      chapter_summaries: [{ chapter_id: "ch1", summary: "归港" }],
      key_events: ["回港"],
      conflicts: ["真相"],
    });
    const provider = new LiveLLMProvider(fixedComplete(json));
    const r = await provider.analyze(source as AnalyzeInput);
    expect(r.characters[0]!.id).toMatch(/^char_/);
    expect(r.locations[0]!.id).toMatch(/^loc_/);
    expect(r.entity_catalog.length).toBe(2);
    expect(r.characters[0]!.source_refs).toEqual(["ch1_p1_aaaa1111"]);
    expect(r.characters[0]!.motivation).toBe("");
  });

  it("throws when given no source paragraphs", async () => {
    const provider = new LiveLLMProvider(fixedComplete("{}"));
    await expect(provider.analyze({ source_fingerprint: "fp" } as AnalyzeInput)).rejects.toThrow();
  });
});

describe("LiveLLMProvider.generateScript", () => {
  const analysis = {
    characters: [{ id: "char_lin", name: "林深", aliases: [], role: "protagonist" as const, motivation: "", relationship_notes: "", source_refs: ["ch1_p1_aaaa1111"] }],
    locations: [{ id: "loc_dock", name: "旧码头", description: "", source_refs: ["ch1_p1_aaaa1111"] }],
    entity_catalog: [{ id: "char_lin", name: "林深" }, { id: "loc_dock", name: "旧码头" }],
    chapter_summaries: [{ chapter_id: "ch1", summary: "归港" }],
    key_events: [],
    conflicts: [],
  };
  const plan = { episodes: [], scene_plan: [], pacing_notes: [], adaptation_strategy: "" };
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
    expect(i).toBe(2);
  });

  it("requires analysis and plan", async () => {
    const provider = new LiveLLMProvider(fixedComplete(creativeJson));
    await expect(provider.generateScript({ ...source } as GenerateInput)).rejects.toThrow();
  });
});

describe("LiveLLMProvider.planScenes", () => {
  it("validates and returns the plan", async () => {
    const planJson = JSON.stringify({
      episodes: [{ episode_no: 1, title: "t", opening_hook: "h", core_conflict: "c", cliffhanger: "cl", estimated_duration_seconds: 120, scene_refs: ["s1"] }],
      scene_plan: [{ episode_no: 1, scene_no: 1, location_id: "loc_dock", summary: "s" }],
      pacing_notes: [], adaptation_strategy: "balanced",
    });
    const analysis = { characters: [], locations: [], entity_catalog: [], chapter_summaries: [], key_events: [], conflicts: [] };
    const provider = new LiveLLMProvider(fixedComplete(planJson));
    const r = await provider.planScenes({ ...source, analysis } as PlanInput);
    expect(r.scene_plan).toHaveLength(1);
  });
});
