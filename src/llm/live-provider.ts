import { ScriptSchema } from "../core/schema/script-schema";
import { getProfileConstraints } from "../core/schema/profiles";
import { normalizeEntities, type RawEntity } from "../core/entities/normalize-entities";
import { scriptToYaml } from "../core/yaml/convert";
import { getLlmConfig } from "./config";
import { makeComplete } from "./client";
import { callJson, extractJson, type ChatMessage, type CompleteFn } from "./json-llm";
import { RawAnalyzeSchema, PlanSchema } from "./output-schemas";
import { buildAnalyzeMessages, buildPlanMessages, buildGenerateMessages } from "./prompts";
import type {
  AnalyzeInput,
  AnalyzeResult,
  GenerateInput,
  GenerateScriptResult,
  PlanInput,
  PlanScenesResult,
  ScriptProvider,
} from "./provider";

type Role = AnalyzeResult["characters"][number]["role"];

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function asRole(v: unknown): Role {
  return v === "protagonist" || v === "antagonist" || v === "minor" ? v : "supporting";
}

export class LiveLLMProvider implements ScriptProvider {
  constructor(private readonly complete: CompleteFn, private readonly maxRetries = 2) {}

  async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    const paragraphs = input.source_paragraphs ?? [];
    if (paragraphs.length === 0) throw new Error("live analyze 需要带文本的原文段落。");
    const validIds = new Set(paragraphs.map((p) => p.id));

    const raw = await callJson({
      complete: this.complete,
      messages: buildAnalyzeMessages(input),
      schema: RawAnalyzeSchema,
      label: "analyze",
      maxRetries: this.maxRetries,
    });

    const chars = normalizeEntities("char", raw.characters as RawEntity[]);
    const locs = normalizeEntities("loc", raw.locations as RawEntity[]);

    const characters: AnalyzeResult["characters"] = chars.entities.map((e) => ({
      id: e.id,
      name: e.name,
      aliases: e.aliases,
      role: asRole(e.role),
      motivation: asStr(e.motivation),
      relationship_notes: asStr(e.relationship_notes),
      source_refs: asStrArr(e.source_refs).filter((r) => validIds.has(r)),
    }));
    const locations: AnalyzeResult["locations"] = locs.entities.map((e) => ({
      id: e.id,
      name: e.name,
      description: asStr(e.description),
      source_refs: asStrArr(e.source_refs).filter((r) => validIds.has(r)),
    }));

    return {
      characters,
      locations,
      entity_catalog: [...chars.catalog, ...locs.catalog],
      chapter_summaries: raw.chapter_summaries,
      key_events: raw.key_events,
      conflicts: raw.conflicts,
    };
  }

  async planScenes(input: PlanInput): Promise<PlanScenesResult> {
    if (!input.analysis) throw new Error("live planScenes 需要 analyze 结果。");
    return callJson({
      complete: this.complete,
      messages: buildPlanMessages(input, input.analysis),
      schema: PlanSchema,
      label: "plan-scenes",
      maxRetries: this.maxRetries,
    });
  }

  async generateScript(input: GenerateInput): Promise<GenerateScriptResult> {
    if (!input.analysis || !input.plan) throw new Error("live generateScript 需要 analyze 与 plan 结果。");
    const messages: ChatMessage[] = [...buildGenerateMessages(input, input.analysis, input.plan)];
    let lastError = "";
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const raw = await this.complete(messages);
      let partial: unknown;
      try {
        partial = JSON.parse(extractJson(raw));
      } catch (e) {
        lastError = `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`;
        messages.push({ role: "assistant", content: raw }, { role: "user", content: `${lastError}。只返回合法 JSON。` });
        continue;
      }
      const assembled = assembleScript(input, input.analysis, partial);
      const result = ScriptSchema.safeParse(assembled);
      if (result.success) {
        if (result.data.episodes.length > 0) {
          return { script_json: result.data, script_yaml: scriptToYaml(result.data) };
        }
        lastError = "episodes 为空";
        messages.push(
          { role: "assistant", content: raw },
          { role: "user", content: "episodes 不能为空，请至少生成一集（含场景与 beats）。只返回合法 json。" },
        );
        continue;
      }
      lastError = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      messages.push(
        { role: "assistant", content: raw },
        { role: "user", content: `剧本结构不合法：${lastError}。请修正 episodes/beats 后只返回合法 JSON（仅 episodes 与 adaptation_notes）。` },
      );
    }
    throw new Error(`live 生成在 ${this.maxRetries + 1} 次尝试后仍未产出合法剧本：${lastError}`);
  }
}

/** Build the full Script from system-owned data + the LLM's creative episodes/notes. */
function assembleScript(input: GenerateInput, analysis: AnalyzeResult, partial: unknown): unknown {
  const p = (partial && typeof partial === "object" ? partial : {}) as Record<string, unknown>;
  const paragraphs = input.source_paragraphs ?? [];
  const chapters = input.chapters ?? [];
  const summaryByChapter = new Map(analysis.chapter_summaries.map((s) => [s.chapter_id, s.summary]));
  return {
    schema_version: "1.0",
    metadata: {
      title: chapters[0]?.title || "未命名作品",
      source_type: "novel",
      target_format: "screenplay",
      adaptation_profile: "short_drama",
      language: "zh-CN",
      created_at: input.created_at ?? "",
      generator: { model: input.model ?? "live", mode: "live" },
      source_fingerprint: input.source_fingerprint,
    },
    adaptation_constraints: getProfileConstraints("short_drama"),
    source_chapters: chapters.map((c) => ({ id: c.id, title: c.title, index: c.index, summary: summaryByChapter.get(c.id) ?? "" })),
    source_paragraphs: paragraphs.map((pp) => ({ id: pp.id, chapter_id: pp.chapter_id, paragraph_index: pp.paragraph_index, text_preview: pp.text_preview, hash: pp.hash })),
    characters: analysis.characters,
    locations: analysis.locations,
    episodes: Array.isArray(p.episodes) ? p.episodes : [],
    adaptation_notes: Array.isArray(p.adaptation_notes) ? p.adaptation_notes : [],
    quality_report: {
      source_coverage_ratio: 0,
      referenced_paragraph_count: 0,
      total_paragraph_count: 0,
      missing_source_refs: [],
      repaired_refs: [],
      untraceable_scenes: [],
      unreferenced_key_paragraphs: [],
      constraint_warnings: [],
      manual_review_suggestions: [],
    },
  };
}

/** Construct a live provider from env config (call only when hasApiKey()). */
export function createLiveProvider(): LiveLLMProvider {
  const config = getLlmConfig();
  return new LiveLLMProvider(makeComplete(config), config.maxRetries);
}
