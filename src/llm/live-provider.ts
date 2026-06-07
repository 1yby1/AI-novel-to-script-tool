import { ScriptSchema } from "../core/schema/script-schema";
import { getProfileConstraints } from "../core/schema/profiles";
import { normalizeEntities, type RawEntity } from "../core/entities/normalize-entities";
import { canonicalizeName } from "../core/entities/entity-id";
import { scriptToYaml } from "../core/yaml/convert";
import { getLlmConfig } from "./config";
import { makeComplete } from "./client";
import { callJson, extractJson, type ChatMessage, type CompleteFn } from "./json-llm";
import { RawAnalyzeSchema, PlanSchema } from "./output-schemas";
import { findPlanConsistencyErrors, normalizePlanCoverage } from "./plan-consistency";
import { buildAnalyzeMessages, buildPlanMessages, buildGenerateMessages } from "./prompts";
import { validateScriptObject } from "../core/validate/full";
import { checkGeneratedScriptAgainstPlan, formatGenerationFeedback, retryableWarnings } from "./generation-feedback";
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
function validRefs(refs: unknown, validIds: ReadonlySet<string>): string[] {
  return asStrArr(refs).filter((ref) => validIds.has(ref));
}
function safeId(id: string, prefix: string, index: number): string {
  const cleaned = id.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return cleaned || `${prefix}_${index + 1}`;
}
function uniqueSafeId(id: string, prefix: string, index: number, seen: Set<string>): string {
  let candidate = safeId(id, prefix, index);
  if (seen.has(candidate)) {
    let n = 2;
    while (seen.has(`${candidate}_${n}`)) n += 1;
    candidate = `${candidate}_${n}`;
  }
  seen.add(candidate);
  return candidate;
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

    const charByName = (name: string): string | undefined => chars.nameToId[canonicalizeName(name)];
    const locByName = (name: string): string | undefined => locs.nameToId[canonicalizeName(name)];
    const eventSeen = new Set<string>();
    const conflictSeen = new Set<string>();
    const hookSeen = new Set<string>();

    const key_events: AnalyzeResult["key_events"] = raw.key_events.map((e, index) => ({
      id: uniqueSafeId(e.id, "evt", index, eventSeen),
      summary: e.summary,
      involved_character_ids: e.involved_character_names
        .map((name) => charByName(name))
        .filter((id): id is string => Boolean(id)),
      location_id: e.location_name ? (locByName(e.location_name) ?? null) : null,
      dramatic_function: e.dramatic_function,
      source_refs: validRefs(e.source_refs, validIds),
    }));

    const conflicts: AnalyzeResult["conflicts"] = raw.conflicts.map((c, index) => ({
      id: uniqueSafeId(c.id, "conf", index, conflictSeen),
      parties: c.parties,
      surface_conflict: c.surface_conflict,
      underlying_tension: c.underlying_tension,
      stakes: c.stakes,
      escalation: c.escalation,
      source_refs: validRefs(c.source_refs, validIds),
    }));

    const relationship_edges: AnalyzeResult["relationship_edges"] = raw.relationship_edges
      .map((edge) => {
        const from = charByName(edge.from_character_name);
        const to = charByName(edge.to_character_name);
        if (!from || !to) return null;
        return {
          from_character_id: from,
          to_character_id: to,
          relation: edge.relation,
          tension: edge.tension,
          source_refs: validRefs(edge.source_refs, validIds),
        };
      })
      .filter((edge): edge is AnalyzeResult["relationship_edges"][number] => edge !== null);

    const hook_candidates: AnalyzeResult["hook_candidates"] = raw.hook_candidates.map((h, index) => ({
      id: uniqueSafeId(h.id, "hook", index, hookSeen),
      description: h.description,
      why_it_hooks: h.why_it_hooks,
      suggested_episode_no: h.suggested_episode_no,
      source_refs: validRefs(h.source_refs, validIds),
    }));

    return {
      characters,
      locations,
      entity_catalog: [...chars.catalog, ...locs.catalog],
      chapter_summaries: raw.chapter_summaries,
      key_events,
      conflicts,
      relationship_edges,
      hook_candidates,
      adaptation_warnings: raw.adaptation_warnings,
    };
  }

  async planScenes(input: PlanInput): Promise<PlanScenesResult> {
    if (!input.analysis) throw new Error("live planScenes 需要 analyze 结果。");
    const analysis = input.analysis;
    const messages: ChatMessage[] = [...buildPlanMessages(input, analysis)];
    let lastError = "";
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const rawText = await this.complete(messages);
      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJson(rawText));
      } catch (e) {
        lastError = `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`;
        messages.push({ role: "assistant", content: rawText }, { role: "user", content: `${lastError}。只返回合法 JSON。` });
        continue;
      }
      const result = PlanSchema.safeParse(parsed);
      if (!result.success) {
        lastError = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        messages.push({ role: "assistant", content: rawText }, { role: "user", content: `分集/分场规划结构不合法：${lastError}。请修正后只返回合法 JSON。` });
        continue;
      }
      const plan = {
        ...result.data,
        coverage: normalizePlanCoverage(result.data as PlanScenesResult, analysis),
      } as PlanScenesResult;
      const consistencyErrors = findPlanConsistencyErrors(plan, analysis, input);
      if (consistencyErrors.length === 0) return plan;
      lastError = consistencyErrors.join("; ");
      messages.push(
        { role: "assistant", content: rawText },
        { role: "user", content: `规划引用了不存在的 ID：${lastError}。只能使用给定 event_ids、character_ids、location_ids 和 source_refs。` },
      );
    }
    throw new Error(`live 分场规划在 ${this.maxRetries + 1} 次尝试后仍不合法：${lastError}`);
  }

  async generateScript(input: GenerateInput): Promise<GenerateScriptResult> {
    if (!input.analysis || !input.plan) throw new Error("live generateScript 需要 analyze 与 plan 结果。");
    const analysis = input.analysis;
    const plan = input.plan;
    const messages: ChatMessage[] = [...buildGenerateMessages(input, analysis, plan)];
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
      const assembled = assembleScript(input, analysis, partial);
      const schemaResult = ScriptSchema.safeParse(assembled);
      if (!schemaResult.success) {
        lastError = schemaResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
        messages.push(
          { role: "assistant", content: raw },
          { role: "user", content: `剧本结构不合法：${lastError}。请修正 episodes/beats 后只返回合法 JSON（仅 episodes 与 adaptation_notes）。` },
        );
        continue;
      }
      if (schemaResult.data.episodes.length === 0) {
        lastError = "episodes 为空";
        messages.push(
          { role: "assistant", content: raw },
          { role: "user", content: "episodes 不能为空，请至少生成一集（含场景与 beats）。只返回合法 json。" },
        );
        continue;
      }

      const canonical = {
        paragraphIds: (input.source_paragraphs ?? []).map((paragraph) => paragraph.id),
        fingerprint: input.source_fingerprint,
      };
      const validation = validateScriptObject(schemaResult.data, { mode: "generate", canonical });
      const validatedScript = validation.script;
      const planFindings = validatedScript ? checkGeneratedScriptAgainstPlan(validatedScript, plan) : [];
      const hardFindings = [...validation.errors, ...planFindings];
      if (hardFindings.length > 0) {
        lastError = formatGenerationFeedback(hardFindings);
        messages.push(
          { role: "assistant", content: raw },
          { role: "user", content: `生成结果未通过确定性校验，请按路径修正后只返回合法 JSON（仅 episodes 与 adaptation_notes）：\n${lastError}` },
        );
        continue;
      }

      const warningFindings = retryableWarnings(validation.warnings);
      if (warningFindings.length > 0 && attempt < this.maxRetries) {
        lastError = formatGenerationFeedback(warningFindings);
        messages.push(
          { role: "assistant", content: raw },
          { role: "user", content: `生成结果可解析但质量不足，请增强 source_refs、开场钩子、结尾悬念与规划一致性后只返回合法 JSON（仅 episodes 与 adaptation_notes）：\n${lastError}` },
        );
        continue;
      }

      const finalScript = validatedScript ?? schemaResult.data;
      return { script_json: finalScript, script_yaml: scriptToYaml(finalScript) };
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
