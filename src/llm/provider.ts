import type { Script } from "../core/schema/script-schema";

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

export interface ScriptProvider {
  analyze(input: { source_fingerprint: string }): Promise<AnalyzeResult>;
  planScenes(input: { source_fingerprint: string }): Promise<PlanScenesResult>;
  generateScript(input: { source_fingerprint: string }): Promise<GenerateScriptResult>;
}
