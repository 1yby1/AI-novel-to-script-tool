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

export interface AnalyzeResult {
  characters: Script["characters"];
  locations: Script["locations"];
  entity_catalog: EntityCatalogItem[];
  chapter_summaries: ChapterSummary[];
  key_events: string[];
  conflicts: string[];
}

export interface ScenePlanEntry {
  episode_no: number;
  scene_no: number;
  location_id: string;
  summary: string;
}

export interface PlanScenesResult {
  episodes: Array<{
    episode_no: number;
    title: string;
    opening_hook: string;
    core_conflict: string;
    cliffhanger: string;
    estimated_duration_seconds: number;
    scene_refs: string[];
  }>;
  scene_plan: ScenePlanEntry[];
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
