import type { Script } from "../../src/core/schema/script-schema";

/**
 * A fresh, schema-valid, constraint-clean Script (short_drama: 3 episodes, hook+cliffhanger
 * present, full source coverage). Tests clone via this factory and mutate to probe failures.
 * Entity/paragraph IDs are arbitrary opaque strings (the schema validates them as strings;
 * referential checks verify existence, not format).
 */
export function validScript(): Script {
  const episode = (n: number, pid: string) => ({
    episode_no: n,
    title: `第${n}集`,
    opening_hook: n === 1 ? "强钩子：他回来了。" : `第${n}集开场。`,
    core_conflict: "核心冲突。",
    cliffhanger: "结尾悬念。",
    estimated_duration_seconds: 120,
    scenes: [
      {
        scene_no: 1,
        heading: { int_ext: "EXT" as const, location_id: "loc_dock", time_of_day: "NIGHT" as const },
        present_character_ids: ["char_lin"],
        summary: "场景摘要。",
        beats: [
          { beat_no: 1, type: "action" as const, source_refs: [pid], description: "动作描述。" },
          { beat_no: 2, type: "dialogue" as const, source_refs: [pid], character_id: "char_lin", line: "台词。" },
        ],
        source_refs: [pid],
      },
    ],
  });

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
      source_fingerprint: "0000000000000000",
    },
    adaptation_constraints: {
      structure_unit: "episode",
      episode_count: 3,
      target_duration_seconds_per_episode: 120,
      opening_hook_required: true,
      cliffhanger_required: true,
      fidelity_level: "balanced",
    },
    source_chapters: [
      { id: "ch1", title: "归港", index: 1, summary: "摘要一。" },
      { id: "ch2", title: "重逢", index: 2, summary: "摘要二。" },
      { id: "ch3", title: "抉择", index: 3, summary: "摘要三。" },
    ],
    source_paragraphs: [
      { id: "ch1_p1_aaaa1111", chapter_id: "ch1", paragraph_index: 1, text_preview: "林深回到了旧码头，海风很冷。", hash: "aaaa1111" },
      { id: "ch2_p1_bbbb2222", chapter_id: "ch2", paragraph_index: 1, text_preview: "她在灯塔下等了他三年之久。", hash: "bbbb2222" },
      { id: "ch3_p1_cccc3333", chapter_id: "ch3", paragraph_index: 1, text_preview: "他终于必须做出那个选择了。", hash: "cccc3333" },
    ],
    characters: [
      { id: "char_lin", name: "林深", aliases: ["老林"], role: "protagonist", motivation: "查清真相", relationship_notes: "与苏晚旧识", source_refs: ["ch1_p1_aaaa1111"] },
    ],
    locations: [
      { id: "loc_dock", name: "旧码头", description: "雾气弥漫。", source_refs: ["ch1_p1_aaaa1111"] },
    ],
    episodes: [episode(1, "ch1_p1_aaaa1111"), episode(2, "ch2_p1_bbbb2222"), episode(3, "ch3_p1_cccc3333")],
    adaptation_notes: [
      { type: "merge", description: "合并次要船员。", source_refs: ["ch1_p1_aaaa1111"] },
    ],
    quality_report: {
      source_coverage_ratio: 1,
      referenced_paragraph_count: 3,
      total_paragraph_count: 3,
      missing_source_refs: [],
      repaired_refs: [],
      untraceable_scenes: [],
      unreferenced_key_paragraphs: [],
      constraint_warnings: [],
      manual_review_suggestions: [],
    },
  };
}
