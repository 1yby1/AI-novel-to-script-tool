import { z } from "zod";

export const SCHEMA_VERSION = "1.0";

/** Adaptation profiles (short_drama is the v1 default/showcase). */
export const ADAPTATION_PROFILES = ["short_drama", "film", "series", "custom"] as const;
export type AdaptationProfile = (typeof ADAPTATION_PROFILES)[number];

// ---- enums ----
const StructureUnit = z.enum(["episode", "act"]);
const FidelityLevel = z.enum(["faithful", "balanced", "creative"]);
const GeneratorMode = z.enum(["live", "fixture"]);
const CharacterRole = z.enum(["protagonist", "antagonist", "supporting", "minor"]);
const IntExt = z.enum(["INT", "EXT", "INT_EXT"]);
const TimeOfDay = z.enum(["DAY", "NIGHT", "DAWN", "DUSK", "CONTINUOUS"]);
const TransitionKind = z.enum(["CUT_TO", "FADE_OUT", "FADE_IN", "DISSOLVE_TO", "SMASH_CUT"]);
const AdaptationNoteType = z.enum(["cut", "merge", "reorder", "original_addition", "pacing"]);

// ---- containers: looseObject (keep unknown keys; warnings handled by the validator) ----
const Generator = z.looseObject({
  model: z.string(),
  mode: GeneratorMode,
});

const Metadata = z.looseObject({
  title: z.string(),
  source_type: z.literal("novel"),
  target_format: z.literal("screenplay"),
  adaptation_profile: z.enum(ADAPTATION_PROFILES),
  language: z.string(),
  created_at: z.string(),
  generator: Generator,
  source_fingerprint: z.string(),
});

export const AdaptationConstraintsSchema = z.looseObject({
  structure_unit: StructureUnit,
  episode_count: z.number().int().min(1),
  target_duration_seconds_per_episode: z.number().int().min(1),
  opening_hook_required: z.boolean(),
  cliffhanger_required: z.boolean(),
  fidelity_level: FidelityLevel,
});

const SourceChapter = z.looseObject({
  id: z.string(),
  title: z.string(),
  index: z.number().int().min(1),
  summary: z.string(),
});

const SourceParagraph = z.looseObject({
  id: z.string(),
  chapter_id: z.string(),
  paragraph_index: z.number().int().min(1),
  text_preview: z.string(),
  hash: z.string(),
});

const Character = z.looseObject({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  role: CharacterRole,
  motivation: z.string(),
  relationship_notes: z.string(),
  source_refs: z.array(z.string()),
});

const Location = z.looseObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  source_refs: z.array(z.string()),
});

// ---- beats: discriminated union of STRICT variants (the one strict exception) ----
const DialogueBeat = z.strictObject({
  beat_no: z.number().int().min(1),
  type: z.literal("dialogue"),
  source_refs: z.array(z.string()),
  character_id: z.string(),
  line: z.string(),
  parenthetical: z.string().optional(),
});
const ActionBeat = z.strictObject({
  beat_no: z.number().int().min(1),
  type: z.literal("action"),
  source_refs: z.array(z.string()),
  description: z.string(),
});
const TransitionBeat = z.strictObject({
  beat_no: z.number().int().min(1),
  type: z.literal("transition"),
  source_refs: z.array(z.string()),
  transition_kind: TransitionKind,
});
export const BeatSchema = z.discriminatedUnion("type", [DialogueBeat, ActionBeat, TransitionBeat]);

const Heading = z.looseObject({
  int_ext: IntExt,
  location_id: z.string(),
  time_of_day: TimeOfDay,
});

const Scene = z.looseObject({
  scene_no: z.number().int().min(1),
  heading: Heading,
  present_character_ids: z.array(z.string()),
  summary: z.string(),
  beats: z.array(BeatSchema),
  source_refs: z.array(z.string()),
});

export const EpisodeSchema = z.looseObject({
  episode_no: z.number().int().min(1),
  title: z.string(),
  opening_hook: z.string(),
  core_conflict: z.string(),
  cliffhanger: z.string(),
  estimated_duration_seconds: z.number().int().min(1),
  scenes: z.array(Scene),
});

const AdaptationNote = z.looseObject({
  type: AdaptationNoteType,
  description: z.string(),
  source_refs: z.array(z.string()).optional(),
});

const QualityReport = z.looseObject({
  source_coverage_ratio: z.number().min(0).max(1),
  referenced_paragraph_count: z.number().int().min(0),
  total_paragraph_count: z.number().int().min(0),
  missing_source_refs: z.array(z.string()),
  repaired_refs: z.array(z.string()),
  untraceable_scenes: z.array(z.string()),
  unreferenced_key_paragraphs: z.array(z.string()),
  constraint_warnings: z.array(z.looseObject({ code: z.string(), message: z.string() })),
  manual_review_suggestions: z.array(z.string()),
});

export const ScriptSchema = z.looseObject({
  schema_version: z.literal(SCHEMA_VERSION),
  metadata: Metadata,
  adaptation_constraints: AdaptationConstraintsSchema,
  source_chapters: z.array(SourceChapter),
  source_paragraphs: z.array(SourceParagraph),
  characters: z.array(Character),
  locations: z.array(Location),
  episodes: z.array(EpisodeSchema),
  adaptation_notes: z.array(AdaptationNote),
  quality_report: QualityReport,
});

export type Script = z.infer<typeof ScriptSchema>;
export type Beat = z.infer<typeof BeatSchema>;
export type AdaptationConstraints = z.infer<typeof AdaptationConstraintsSchema>;

/**
 * Allowed keys per container object, used by the validator to emit non-blocking
 * UNKNOWN_FIELD warnings (containers are looseObject so unknown keys are KEPT, not
 * errored). Must stay in sync with the schemas above. Beats are validated strictly
 * by Zod and are intentionally NOT listed here.
 */
export const KNOWN_KEYS = {
  root: ["schema_version", "metadata", "adaptation_constraints", "source_chapters", "source_paragraphs", "characters", "locations", "episodes", "adaptation_notes", "quality_report"],
  metadata: ["title", "source_type", "target_format", "adaptation_profile", "language", "created_at", "generator", "source_fingerprint"],
  generator: ["model", "mode"],
  adaptation_constraints: ["structure_unit", "episode_count", "target_duration_seconds_per_episode", "opening_hook_required", "cliffhanger_required", "fidelity_level"],
  source_chapter: ["id", "title", "index", "summary"],
  source_paragraph: ["id", "chapter_id", "paragraph_index", "text_preview", "hash"],
  character: ["id", "name", "aliases", "role", "motivation", "relationship_notes", "source_refs"],
  location: ["id", "name", "description", "source_refs"],
  episode: ["episode_no", "title", "opening_hook", "core_conflict", "cliffhanger", "estimated_duration_seconds", "scenes"],
  scene: ["scene_no", "heading", "present_character_ids", "summary", "beats", "source_refs"],
  heading: ["int_ext", "location_id", "time_of_day"],
  adaptation_note: ["type", "description", "source_refs"],
  quality_report: ["source_coverage_ratio", "referenced_paragraph_count", "total_paragraph_count", "missing_source_refs", "repaired_refs", "untraceable_scenes", "unreferenced_key_paragraphs", "constraint_warnings", "manual_review_suggestions"],
} as const;
