import { describe, it, expect } from "vitest";
import { ScriptSchema, BeatSchema, KNOWN_KEYS } from "../../src/core/schema/script-schema";

/** A complete, valid Script object. Tests clone and mutate it to probe failures. */
function validScript() {
  return {
    schema_version: "1.0",
    metadata: {
      title: "雾港旧约",
      source_type: "novel",
      target_format: "screenplay",
      adaptation_profile: "short_drama",
      language: "zh-CN",
      created_at: "2026-06-05T00:00:00Z",
      generator: { model: "fixture", mode: "fixture" },
      source_fingerprint: "abc123def456",
    },
    adaptation_constraints: {
      structure_unit: "episode",
      episode_count: 3,
      target_duration_seconds_per_episode: 120,
      opening_hook_required: true,
      cliffhanger_required: true,
      fidelity_level: "balanced",
    },
    source_chapters: [{ id: "ch1", title: "归港", index: 1, summary: "林深归来。" }],
    source_paragraphs: [
      { id: "ch1_p1_a1b2c3d4", chapter_id: "ch1", paragraph_index: 1, text_preview: "林深回到旧码头。", hash: "a1b2c3d4" },
    ],
    characters: [
      { id: "char_abc123", name: "林深", aliases: ["老林"], role: "protagonist", motivation: "复仇", relationship_notes: "", source_refs: ["ch1_p1_a1b2c3d4"] },
    ],
    locations: [{ id: "loc_def456", name: "旧码头", description: "雾气弥漫。", source_refs: ["ch1_p1_a1b2c3d4"] }],
    episodes: [
      {
        episode_no: 1,
        title: "归来",
        opening_hook: "钩子",
        core_conflict: "冲突",
        cliffhanger: "悬念",
        estimated_duration_seconds: 120,
        scenes: [
          {
            scene_no: 1,
            heading: { int_ext: "EXT", location_id: "loc_def456", time_of_day: "NIGHT" },
            present_character_ids: ["char_abc123"],
            summary: "林深登岸。",
            beats: [
              { beat_no: 1, type: "action", source_refs: ["ch1_p1_a1b2c3d4"], description: "林深踏上栈桥。" },
              { beat_no: 2, type: "dialogue", source_refs: ["ch1_p1_a1b2c3d4"], character_id: "char_abc123", line: "三年了。" },
              { beat_no: 3, type: "transition", source_refs: [], transition_kind: "CUT_TO" },
            ],
            source_refs: ["ch1_p1_a1b2c3d4"],
          },
        ],
      },
    ],
    adaptation_notes: [{ type: "merge", description: "合并次要船员。", source_refs: [] }],
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
}

describe("ScriptSchema", () => {
  it("accepts a complete valid script", () => {
    expect(ScriptSchema.safeParse(validScript()).success).toBe(true);
  });

  it("rejects a missing required field", () => {
    const s = validScript();
    delete (s.metadata as Record<string, unknown>).title;
    expect(ScriptSchema.safeParse(s).success).toBe(false);
  });

  it("rejects an invalid enum value", () => {
    const s = validScript();
    s.episodes[0]!.scenes[0]!.heading.time_of_day = "MIDNIGHT";
    expect(ScriptSchema.safeParse(s).success).toBe(false);
  });

  it("keeps unknown keys on container objects (looseObject, not dropped)", () => {
    const s = validScript();
    (s.metadata as Record<string, unknown>).custom_note = "作者批注";
    const r = ScriptSchema.safeParse(s);
    expect(r.success).toBe(true);
    expect(r.success && (r.data.metadata as Record<string, unknown>).custom_note).toBe("作者批注");
  });

  it("rejects a beat carrying a field from another beat type (beats are strict)", () => {
    const s = validScript();
    (s.episodes[0]!.scenes[0]!.beats[1] as Record<string, unknown>).description = "越界字段";
    expect(ScriptSchema.safeParse(s).success).toBe(false);
  });

  it("rejects a dialogue beat missing its required line", () => {
    const s = validScript();
    delete (s.episodes[0]!.scenes[0]!.beats[1] as Record<string, unknown>).line;
    expect(ScriptSchema.safeParse(s).success).toBe(false);
  });
});

describe("BeatSchema", () => {
  it("accepts each beat variant", () => {
    expect(BeatSchema.safeParse({ beat_no: 1, type: "action", source_refs: [], description: "x" }).success).toBe(true);
    expect(BeatSchema.safeParse({ beat_no: 1, type: "dialogue", source_refs: [], character_id: "c", line: "hi" }).success).toBe(true);
    expect(BeatSchema.safeParse({ beat_no: 1, type: "transition", source_refs: [], transition_kind: "FADE_OUT" }).success).toBe(true);
  });
  it("rejects an unknown beat type", () => {
    expect(BeatSchema.safeParse({ beat_no: 1, type: "song", source_refs: [] }).success).toBe(false);
  });
});

describe("KNOWN_KEYS", () => {
  it("lists the top-level keys", () => {
    expect(KNOWN_KEYS.root).toContain("episodes");
    expect(KNOWN_KEYS.scene).toContain("beats");
  });
});
