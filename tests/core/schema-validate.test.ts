import { describe, it, expect } from "vitest";
import { validateSchema, formatPath } from "../../src/core/validate/schema-validate";

function validScript() {
  return {
    schema_version: "1.0",
    metadata: {
      title: "雾港旧约", source_type: "novel", target_format: "screenplay",
      adaptation_profile: "short_drama", language: "zh-CN", created_at: "2026-06-05T00:00:00Z",
      generator: { model: "fixture", mode: "fixture" }, source_fingerprint: "abc123",
    },
    adaptation_constraints: {
      structure_unit: "episode", episode_count: 3, target_duration_seconds_per_episode: 120,
      opening_hook_required: true, cliffhanger_required: true, fidelity_level: "balanced",
    },
    source_chapters: [{ id: "ch1", title: "归港", index: 1, summary: "s" }],
    source_paragraphs: [{ id: "ch1_p1_a1b2c3d4", chapter_id: "ch1", paragraph_index: 1, text_preview: "p", hash: "a1b2c3d4" }],
    characters: [{ id: "char_abc123", name: "林深", aliases: [], role: "protagonist", motivation: "m", relationship_notes: "", source_refs: ["ch1_p1_a1b2c3d4"] }],
    locations: [{ id: "loc_def456", name: "旧码头", description: "", source_refs: [] }],
    episodes: [{
      episode_no: 1, title: "归来", opening_hook: "h", core_conflict: "c", cliffhanger: "cl",
      estimated_duration_seconds: 120,
      scenes: [{
        scene_no: 1, heading: { int_ext: "EXT", location_id: "loc_def456", time_of_day: "NIGHT" },
        present_character_ids: ["char_abc123"], summary: "s",
        beats: [
          { beat_no: 1, type: "action", source_refs: ["ch1_p1_a1b2c3d4"], description: "d" },
          { beat_no: 2, type: "dialogue", source_refs: ["ch1_p1_a1b2c3d4"], character_id: "char_abc123", line: "l" },
        ],
        source_refs: ["ch1_p1_a1b2c3d4"],
      }],
    }],
    adaptation_notes: [{ type: "merge", description: "d", source_refs: [] }],
    quality_report: {
      source_coverage_ratio: 1, referenced_paragraph_count: 1, total_paragraph_count: 1,
      missing_source_refs: [], repaired_refs: [], untraceable_scenes: [],
      unreferenced_key_paragraphs: [], constraint_warnings: [], manual_review_suggestions: [],
    },
  };
}

describe("formatPath", () => {
  it("renders array indices as [n] and keys with dots", () => {
    expect(formatPath(["episodes", 1, "scenes", 0, "beats", 3, "source_refs", 2]))
      .toBe("episodes[1].scenes[0].beats[3].source_refs[2]");
  });
  it("renders a leading key without a leading dot", () => {
    expect(formatPath(["metadata", "title"])).toBe("metadata.title");
  });
});

describe("validateSchema", () => {
  it("reports a valid script with no errors or warnings", () => {
    const r = validateSchema(validScript());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("flags a missing required field as SCHEMA_ERROR with its path", () => {
    const s = validScript();
    delete (s.metadata as Record<string, unknown>).title;
    const r = validateSchema(s);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCHEMA_ERROR" && e.path === "metadata.title")).toBe(true);
  });

  it("flags a beat with a foreign field as SCHEMA_ERROR pointing at the beat", () => {
    const s = validScript();
    (s.episodes[0]!.scenes[0]!.beats[1] as Record<string, unknown>).description = "越界";
    const r = validateSchema(s);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCHEMA_ERROR" && e.path.includes("episodes[0].scenes[0].beats[1]"))).toBe(true);
  });

  it("emits a non-blocking UNKNOWN_FIELD warning for an unknown container key (still valid)", () => {
    const s = validScript();
    (s.metadata as Record<string, unknown>).custom_note = "批注";
    const r = validateSchema(s);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.code === "UNKNOWN_FIELD" && w.path === "metadata.custom_note")).toBe(true);
  });

  it("warns about an unknown top-level key", () => {
    const s = validScript();
    (s as Record<string, unknown>).extra_top = 1;
    const r = validateSchema(s);
    expect(r.warnings.some((w) => w.code === "UNKNOWN_FIELD" && w.path === "extra_top")).toBe(true);
  });

  it("flags an invalid enum value as an error", () => {
    const s = validScript();
    s.episodes[0]!.scenes[0]!.heading.time_of_day = "MIDNIGHT";
    expect(validateSchema(s).valid).toBe(false);
  });

  it("does not throw on non-object input", () => {
    expect(validateSchema(null).valid).toBe(false);
    expect(validateSchema("nope").valid).toBe(false);
  });
});
