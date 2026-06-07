import { z } from "zod";

const RawEventCardSchema = z.object({
  id: z.string(),
  summary: z.string(),
  involved_character_names: z.array(z.string()).default([]),
  location_name: z.string().nullable().default(null),
  dramatic_function: z.enum(["hook", "setup", "conflict", "reversal", "climax", "resolution"]),
  source_refs: z.array(z.string()).default([]),
});

const RawConflictCardSchema = z.object({
  id: z.string(),
  parties: z.array(z.string()).default([]),
  surface_conflict: z.string(),
  underlying_tension: z.string(),
  stakes: z.string(),
  escalation: z.string(),
  source_refs: z.array(z.string()).default([]),
});

const RawRelationshipEdgeSchema = z.object({
  from_character_name: z.string(),
  to_character_name: z.string(),
  relation: z.string(),
  tension: z.string(),
  source_refs: z.array(z.string()).default([]),
});

const RawHookCandidateSchema = z.object({
  id: z.string(),
  description: z.string(),
  why_it_hooks: z.string(),
  suggested_episode_no: z.number().int().min(1),
  source_refs: z.array(z.string()).default([]),
});

/** Analyze-stage output: entities use NAMES (system assigns IDs); dramaturgy is structured cards. */
export const RawAnalyzeSchema = z.object({
  characters: z.array(
    z.looseObject({
      name: z.string(),
      aliases: z.array(z.string()).optional(),
      role: z.enum(["protagonist", "antagonist", "supporting", "minor"]).optional(),
      motivation: z.string().optional(),
      relationship_notes: z.string().optional(),
      source_refs: z.array(z.string()).optional(),
    }),
  ),
  locations: z.array(
    z.looseObject({
      name: z.string(),
      description: z.string().optional(),
      source_refs: z.array(z.string()).optional(),
    }),
  ),
  chapter_summaries: z.array(z.object({ chapter_id: z.string(), summary: z.string() })),
  key_events: z.array(RawEventCardSchema),
  conflicts: z.array(RawConflictCardSchema),
  relationship_edges: z.array(RawRelationshipEdgeSchema).default([]),
  hook_candidates: z.array(RawHookCandidateSchema).default([]),
  adaptation_warnings: z.array(z.string()).default([]),
});
export type RawAnalyze = z.infer<typeof RawAnalyzeSchema>;

/**
 * Plan-stage output v2 (episode goals + scene purposes + event linkage). `coverage` is optional
 * in raw output because LiveLLMProvider recomputes it deterministically.
 */
export const PlanSchema = z.object({
  episodes: z.array(
    z.object({
      episode_no: z.number().int().min(1),
      title: z.string(),
      opening_hook: z.string(),
      main_goal: z.string(),
      core_conflict: z.string(),
      turning_point: z.string(),
      cliffhanger: z.string(),
      estimated_duration_seconds: z.number().int().min(1),
      event_ids: z.array(z.string()).default([]),
      source_refs: z.array(z.string()).default([]),
    }),
  ),
  scene_plan: z.array(
    z.object({
      episode_no: z.number().int().min(1),
      scene_no: z.number().int().min(1),
      location_id: z.string(),
      purpose: z.string(),
      conflict: z.string(),
      emotional_shift: z.string(),
      required_character_ids: z.array(z.string()).default([]),
      event_ids: z.array(z.string()).default([]),
      source_refs: z.array(z.string()).default([]),
      summary: z.string(),
    }),
  ),
  coverage: z
    .object({
      covered_event_ids: z.array(z.string()).default([]),
      omitted_event_ids: z.array(z.string()).default([]),
      coverage_ratio: z.number().min(0).max(1),
    })
    .optional(),
  pacing_notes: z.array(z.string()),
  adaptation_strategy: z.string(),
});
export type Plan = z.infer<typeof PlanSchema>;
