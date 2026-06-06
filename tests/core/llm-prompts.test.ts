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
  key_events: [],
  conflicts: [],
};
const plan: PlanScenesResult = {
  episodes: [{ episode_no: 1, title: "归来", opening_hook: "h", core_conflict: "c", cliffhanger: "cl", estimated_duration_seconds: 120, scene_refs: ["s1"] }],
  scene_plan: [{ episode_no: 1, scene_no: 1, location_id: "loc_dock", summary: "s" }],
  pacing_notes: [],
  adaptation_strategy: "balanced",
};

describe("prompts", () => {
  it("analyze injects the paragraph text and forbids inventing IDs", () => {
    const msgs = buildAnalyzeMessages(source);
    const joined = msgs.map((m) => m.content).join("\n");
    expect(joined).toContain("ch1_p1_aaaa1111");
    expect(joined).toContain("林深回到旧码头");
    expect(msgs[0]!.role).toBe("system");
  });
  it("plan injects the legal entity catalog and paragraph IDs", () => {
    const joined = buildPlanMessages(source, analysis).map((m) => m.content).join("\n");
    expect(joined).toContain("char_lin");
    expect(joined).toContain("loc_dock");
    expect(joined).toContain("ch1_p1_aaaa1111");
  });
  it("generate injects legal IDs and the prior plan", () => {
    const joined = buildGenerateMessages(source, analysis, plan).map((m) => m.content).join("\n");
    expect(joined).toContain("ch1_p1_aaaa1111");
    expect(joined).toContain("char_lin");
    expect(joined).toContain("schema_version");
  });
});
