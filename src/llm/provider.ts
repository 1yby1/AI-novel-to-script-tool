import type { Script } from "../core/schema/script-schema";
import type { SourceChapter, SourceParagraph as ParsedParagraph } from "../core/parse/chapters";

export interface EntityCatalogItem {
  id: string;
  name: string;
}

export interface ChapterSummary {
  chapter_id: string;
  summary: string;
}

export type DramaticFunction = "hook" | "setup" | "conflict" | "reversal" | "climax" | "resolution";

export interface KeyEventCard {
  id: string;
  summary: string;
  involved_character_ids: string[];
  location_id: string | null;
  dramatic_function: DramaticFunction;
  source_refs: string[];
}

export interface ConflictCard {
  id: string;
  parties: string[];
  surface_conflict: string;
  underlying_tension: string;
  stakes: string;
  escalation: string;
  source_refs: string[];
}

export interface RelationshipEdge {
  from_character_id: string;
  to_character_id: string;
  relation: string;
  tension: string;
  source_refs: string[];
}

export interface HookCandidate {
  id: string;
  description: string;
  why_it_hooks: string;
  suggested_episode_no: number;
  source_refs: string[];
}

export interface AnalyzeResult {
  characters: Script["characters"];
  locations: Script["locations"];
  entity_catalog: EntityCatalogItem[];
  chapter_summaries: ChapterSummary[];
  key_events: KeyEventCard[];
  conflicts: ConflictCard[];
  relationship_edges: RelationshipEdge[];
  hook_candidates: HookCandidate[];
  adaptation_warnings: string[];
}

export interface EpisodePlan {
  episode_no: number;
  title: string;
  opening_hook: string;
  main_goal: string;
  core_conflict: string;
  turning_point: string;
  cliffhanger: string;
  estimated_duration_seconds: number;
  event_ids: string[];
  source_refs: string[];
}

export interface ScenePlanEntry {
  episode_no: number;
  scene_no: number;
  location_id: string;
  purpose: string;
  conflict: string;
  emotional_shift: string;
  required_character_ids: string[];
  event_ids: string[];
  source_refs: string[];
  summary: string;
}

export interface PlanCoverage {
  covered_event_ids: string[];
  omitted_event_ids: string[];
  coverage_ratio: number;
}

export interface PlanScenesResult {
  episodes: EpisodePlan[];
  scene_plan: ScenePlanEntry[];
  coverage: PlanCoverage;
  pacing_notes: string[];
  adaptation_strategy: string;
}

export interface GenerateScriptResult {
  script_json: Script;
  script_yaml: string;
}

/** Source content + fingerprint shared by every stage. Optional fields are unused by the
 *  fixture provider (gated by fingerprint) but required by the live provider. */
export interface SourceContext {
  source_fingerprint: string;
  chapters?: SourceChapter[];
  source_paragraphs?: ParsedParagraph[]; // include full `text` for the LLM
}

export type AnalyzeInput = SourceContext;
export interface PlanInput extends SourceContext {
  analysis?: AnalyzeResult;
}
export interface GenerateInput extends SourceContext {
  analysis?: AnalyzeResult;
  plan?: PlanScenesResult;
  created_at?: string;
  model?: string;
}

export interface ScriptProvider {
  analyze(input: AnalyzeInput): Promise<AnalyzeResult>;
  planScenes(input: PlanInput): Promise<PlanScenesResult>;
  generateScript(input: GenerateInput): Promise<GenerateScriptResult>;
}
