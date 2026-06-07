import { describe, expect, it } from "vitest";
import { checkGeneratedScriptAgainstPlan, formatGenerationFeedback, retryableGenerationWarnings } from "../../src/llm/generation-feedback";
import type { Script } from "../../src/core/schema/script-schema";
import type { PlanScenesResult } from "../../src/llm/provider";
import type { ValidationItem } from "../../src/core/validate/schema-validate";

const script: Script = {
  schema_version: "1.0",
  metadata: {
    title: "测试",
    source_type: "novel",
    target_format: "screenplay",
    adaptation_profile: "short_drama",
    language: "zh-CN",
    created_at: "2026-06-07T00:00:00.000Z",
    generator: { model: "test", mode: "live" },
    source_fingerprint: "fp",
  },
  adaptation_constraints: {
    structure_unit: "episode",
    episode_count: 1,
    target_duration_seconds_per_episode: 120,
    opening_hook_required: true,
    cliffhanger_required: true,
    fidelity_level: "balanced",
  },
  source_chapters: [{ id: "ch1", title: "归港", index: 1, summary: "x" }],
  source_paragraphs: [{ id: "ch1_p1_a", chapter_id: "ch1", paragraph_index: 1, text_preview: "x", hash: "a" }],
  characters: [{ id: "char_lin", name: "林深", aliases: [], role: "protagonist", motivation: "x", relationship_notes: "x", source_refs: ["ch1_p1_a"] }],
  locations: [{ id: "loc_dock", name: "旧码头", description: "x", source_refs: ["ch1_p1_a"] }],
  episodes: [{
    episode_no: 1,
    title: "归来",
    opening_hook: "他回来了",
    core_conflict: "追查真相",
    cliffhanger: "灯灭",
    estimated_duration_seconds: 120,
    scenes: [{
      scene_no: 1,
      heading: { int_ext: "EXT", location_id: "loc_dock", time_of_day: "NIGHT" },
      present_character_ids: ["char_lin"],
      summary: "登岸",
      beats: [{ beat_no: 1, type: "action", description: "林深踏上旧码头。", source_refs: ["ch1_p1_a"] }],
      source_refs: ["ch1_p1_a"],
    }],
  }],
  adaptation_notes: [],
  quality_report: {
    source_coverage_ratio: 1,
    referenced_paragraph_count: 1,
    total_paragraph_count: 1,
    missing_source_refs: [],
    repaired_refs: [],
    untraceable_scenes: [],
    unreferenced_key_paragraphs: [],
    constraint_warnings: [],
    manual_review_suggestions: [],
  },
};

const plan: PlanScenesResult = {
  episodes: [{
    episode_no: 1,
    title: "归来",
    opening_hook: "h",
    main_goal: "确认线索",
    core_conflict: "追查真相",
    turning_point: "灯灭",
    cliffhanger: "cl",
    estimated_duration_seconds: 120,
    event_ids: ["evt_1"],
    source_refs: ["ch1_p1_a"],
  }],
  scene_plan: [{
    episode_no: 1,
    scene_no: 1,
    location_id: "loc_dock",
    purpose: "建立归港钩子",
    conflict: "林深被旧案刺痛",
    emotional_shift: "克制 -> 警觉",
    required_character_ids: ["char_lin"],
    event_ids: ["evt_1"],
    source_refs: ["ch1_p1_a"],
    summary: "林深归港。",
  }],
  coverage: { covered_event_ids: ["evt_1"], omitted_event_ids: [], coverage_ratio: 1 },
  pacing_notes: [],
  adaptation_strategy: "balanced",
};

describe("checkGeneratedScriptAgainstPlan", () => {
  it("accepts a generated script that follows the planned scene location, characters, and refs", () => {
    expect(checkGeneratedScriptAgainstPlan(script, plan)).toEqual([]);
  });

  it("reports missing planned scenes", () => {
    const broken: Script = { ...script, episodes: [{ ...script.episodes[0]!, scenes: [] }] };
    expect(checkGeneratedScriptAgainstPlan(broken, plan)).toEqual([
      { path: "episodes[0].scenes", code: "PLAN_ADHERENCE", message: "缺少规划场景：第 1 集第 1 场（建立归港钩子）" },
    ]);
  });

  it("reports scene location, character, and source-ref drift", () => {
    const broken: Script = {
      ...script,
      episodes: [{
        ...script.episodes[0]!,
        scenes: [{
          ...script.episodes[0]!.scenes[0]!,
          heading: { ...script.episodes[0]!.scenes[0]!.heading, location_id: "loc_other" },
          present_character_ids: [],
          source_refs: [],
          beats: [{ beat_no: 1, type: "action", description: "无出处动作。", source_refs: [] }],
        }],
      }],
    };
    expect(checkGeneratedScriptAgainstPlan(broken, plan)).toEqual([
      { path: "episodes[0].scenes[0].heading.location_id", code: "PLAN_ADHERENCE", message: "生成场景地点 loc_other 与规划地点 loc_dock 不一致" },
      { path: "episodes[0].scenes[0].present_character_ids", code: "PLAN_ADHERENCE", message: "生成场景缺少规划要求人物：char_lin" },
      { path: "episodes[0].scenes[0].source_refs", code: "PLAN_ADHERENCE", message: "生成场景未覆盖规划 source_refs：ch1_p1_a" },
    ]);
  });
});

describe("formatGenerationFeedback", () => {
  it("formats errors and retryable warnings with paths", () => {
    const items: ValidationItem[] = [
      { path: "episodes[0].scenes[0].beats[0].source_refs[0]", code: "INVALID_SOURCE_REF", message: "source_ref 不存在：bad" },
      { path: "quality_report.source_coverage_ratio", code: "WEAK_TRACEABILITY", message: "原文覆盖率偏低：0%" },
    ];
    expect(formatGenerationFeedback(items)).toContain("INVALID_SOURCE_REF @ episodes[0].scenes[0].beats[0].source_refs[0]");
    expect(formatGenerationFeedback(items)).toContain("WEAK_TRACEABILITY @ quality_report.source_coverage_ratio");
  });

  it("defines the warning codes that should trigger a retry before the final attempt", () => {
    expect(retryableGenerationWarnings.has("WEAK_TRACEABILITY")).toBe(true);
    expect(retryableGenerationWarnings.has("CONSTRAINT_WARNING")).toBe(true);
  });
});
