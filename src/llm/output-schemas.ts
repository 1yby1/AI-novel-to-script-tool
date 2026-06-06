import { z } from "zod";

/** Analyze-stage output: entities WITHOUT system IDs (normalizeEntities assigns them). */
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
  key_events: z.array(z.string()),
  conflicts: z.array(z.string()),
});
export type RawAnalyze = z.infer<typeof RawAnalyzeSchema>;

/** Plan-stage output (episode skeleton + scene plan). */
export const PlanSchema = z.object({
  episodes: z.array(
    z.object({
      episode_no: z.number().int().min(1),
      title: z.string(),
      opening_hook: z.string(),
      core_conflict: z.string(),
      cliffhanger: z.string(),
      estimated_duration_seconds: z.number().int().min(1),
      scene_refs: z.array(z.string()),
    }),
  ),
  scene_plan: z.array(
    z.object({
      episode_no: z.number().int().min(1),
      scene_no: z.number().int().min(1),
      location_id: z.string(),
      summary: z.string(),
    }),
  ),
  pacing_notes: z.array(z.string()),
  adaptation_strategy: z.string(),
});
export type Plan = z.infer<typeof PlanSchema>;
