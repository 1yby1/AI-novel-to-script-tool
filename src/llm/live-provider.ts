import { ScriptSchema, EpisodeSchema, type Script } from "../core/schema/script-schema";
import { getProfileConstraints } from "../core/schema/profiles";
import { normalizeEntities, type RawEntity } from "../core/entities/normalize-entities";
import { canonicalizeName } from "../core/entities/entity-id";
import { scriptToYaml } from "../core/yaml/convert";
import { getLlmConfig } from "./config";
import { makeComplete } from "./client";
import { callJson, extractJson, type ChatMessage, type CompleteFn } from "./json-llm";
import { RawAnalyzeSchema, PlanSchema } from "./output-schemas";
import { findPlanConsistencyErrors, normalizePlanCoverage } from "./plan-consistency";
import { buildAnalyzeMessages, buildPlanMessages, buildGenerateMessages, buildEpisodeMessages } from "./prompts";
import { validateScriptObject } from "../core/validate/full";
import { checkGeneratedScriptAgainstPlan, formatGenerationFeedback, retryableWarnings } from "./generation-feedback";
import { checkReferential } from "../core/validate/referential";
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
type LiveProviderStage = "analyze" | "plan-scenes" | "generate-script";
type LiveProviderAttemptEvent = "start" | "model_response" | "retry" | "success" | "error";

export interface LiveProviderAttemptLog {
  stage: LiveProviderStage;
  event: LiveProviderAttemptEvent;
  attempt: number;
  maxAttempts: number;
  message_count?: number;
  elapsed_ms?: number;
  output_chars?: number;
  reason?: string;
}

export type LiveProviderAttemptLogger = (event: LiveProviderAttemptLog) => void;

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

function summarizeAttemptReason(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 500 ? `${compact.slice(0, 497)}...` : compact;
}

function defaultAttemptLogger(event: LiveProviderAttemptLog): void {
  if (process.env.VITEST || process.env.NODE_ENV === "test") return;
  const parts = [
    `stage=${event.stage}`,
    `event=${event.event}`,
    `attempt=${event.attempt}/${event.maxAttempts}`,
  ];
  if (event.message_count !== undefined) parts.push(`messages=${event.message_count}`);
  if (event.elapsed_ms !== undefined) parts.push(`elapsed_ms=${event.elapsed_ms}`);
  if (event.output_chars !== undefined) parts.push(`output_chars=${event.output_chars}`);
  if (event.reason) parts.push(`reason="${event.reason}"`);
  console.info(`[live-provider] ${parts.join(" ")}`);
}

export class LiveLLMProvider implements ScriptProvider {
  constructor(
    private readonly complete: CompleteFn,
    private readonly maxRetries = 2,
    private readonly attemptLogger: LiveProviderAttemptLogger = defaultAttemptLogger,
  ) {}

  private logAttempt(stage: LiveProviderStage, event: LiveProviderAttemptEvent, attempt: number, details: Omit<LiveProviderAttemptLog, "stage" | "event" | "attempt" | "maxAttempts"> = {}): void {
    this.attemptLogger({
      stage,
      event,
      attempt,
      maxAttempts: this.maxRetries + 1,
      ...details,
    });
  }

  private async completeAttempt(stage: LiveProviderStage, messages: ChatMessage[], attempt: number, attemptStartedAt: number): Promise<string> {
    this.logAttempt(stage, "start", attempt, { message_count: messages.length });
    try {
      const raw = await this.complete(messages);
      this.logAttempt(stage, "model_response", attempt, {
        elapsed_ms: Date.now() - attemptStartedAt,
        output_chars: raw.length,
      });
      return raw;
    } catch (e) {
      this.logAttempt(stage, "error", attempt, {
        elapsed_ms: Date.now() - attemptStartedAt,
        reason: summarizeAttemptReason(e),
      });
      throw e;
    }
  }

  private logAttemptRetry(stage: LiveProviderStage, attempt: number, attemptStartedAt: number, reason: string): void {
    this.logAttempt(stage, "retry", attempt, {
      elapsed_ms: Date.now() - attemptStartedAt,
      reason: summarizeAttemptReason(reason),
    });
  }

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
      onAttemptStart: (attempt, _maxAttempts, messageCount) => this.logAttempt("analyze", "start", attempt, { message_count: messageCount }),
      onAttemptComplete: (attempt, elapsedMs, outputChars) => this.logAttempt("analyze", "model_response", attempt, { elapsed_ms: elapsedMs, output_chars: outputChars }),
      onAttemptRetry: (attempt, elapsedMs, reason) => this.logAttempt("analyze", "retry", attempt, { elapsed_ms: elapsedMs, reason: summarizeAttemptReason(reason) }),
      onAttemptSuccess: (attempt, elapsedMs) => this.logAttempt("analyze", "success", attempt, { elapsed_ms: elapsedMs }),
      onAttemptError: (attempt, elapsedMs, error) => this.logAttempt("analyze", "error", attempt, { elapsed_ms: elapsedMs, reason: summarizeAttemptReason(error) }),
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
      const attemptNumber = attempt + 1;
      const attemptStartedAt = Date.now();
      const rawText = await this.completeAttempt("plan-scenes", messages, attemptNumber, attemptStartedAt);
      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJson(rawText));
      } catch (e) {
        lastError = `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`;
        this.logAttemptRetry("plan-scenes", attemptNumber, attemptStartedAt, lastError);
        messages.push({ role: "assistant", content: rawText }, { role: "user", content: `${lastError}。只返回合法 JSON。` });
        continue;
      }
      const result = PlanSchema.safeParse(parsed);
      if (!result.success) {
        lastError = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        this.logAttemptRetry("plan-scenes", attemptNumber, attemptStartedAt, lastError);
        messages.push({ role: "assistant", content: rawText }, { role: "user", content: `分集/分场规划结构不合法：${lastError}。请修正后只返回合法 JSON。` });
        continue;
      }
      const plan = {
        ...result.data,
        coverage: normalizePlanCoverage(result.data as PlanScenesResult, analysis),
      } as PlanScenesResult;
      const consistencyErrors = findPlanConsistencyErrors(plan, analysis, input);
      if (consistencyErrors.length === 0) {
        this.logAttempt("plan-scenes", "success", attemptNumber, { elapsed_ms: Date.now() - attemptStartedAt });
        return plan;
      }
      lastError = consistencyErrors.join("; ");
      this.logAttemptRetry("plan-scenes", attemptNumber, attemptStartedAt, lastError);
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
    // Fast path: generate episodes in PARALLEL when the plan defines them (the production case),
    // so wall-clock ≈ slowest single episode. Falls back to whole-script generation below if
    // per-episode generation can't be validated.
    if (plan.episodes.length > 0) {
      try {
        return await this.generateByEpisode(input, analysis, plan);
      } catch (e) {
        this.logAttempt("generate-script", "error", 0, { reason: summarizeAttemptReason(e) });
      }
    }
    const messages: ChatMessage[] = [...buildGenerateMessages(input, analysis, plan)];
    let lastError = "";
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const attemptNumber = attempt + 1;
      const attemptStartedAt = Date.now();
      const raw = await this.completeAttempt("generate-script", messages, attemptNumber, attemptStartedAt);
      let partial: unknown;
      try {
        partial = JSON.parse(extractJson(raw));
      } catch (e) {
        lastError = `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`;
        this.logAttemptRetry("generate-script", attemptNumber, attemptStartedAt, lastError);
        messages.push({ role: "assistant", content: raw }, { role: "user", content: `${lastError}。只返回合法 JSON。` });
        continue;
      }
      const assembled = assembleScript(input, analysis, partial);
      const schemaResult = ScriptSchema.safeParse(assembled);
      if (!schemaResult.success) {
        lastError = schemaResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
        this.logAttemptRetry("generate-script", attemptNumber, attemptStartedAt, lastError);
        messages.push(
          { role: "assistant", content: raw },
          { role: "user", content: `剧本结构不合法：${lastError}。请修正 episodes/beats 后只返回合法 JSON（仅 episodes 与 adaptation_notes）。` },
        );
        continue;
      }
      if (schemaResult.data.episodes.length === 0) {
        lastError = "episodes 为空";
        this.logAttemptRetry("generate-script", attemptNumber, attemptStartedAt, lastError);
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
        this.logAttemptRetry("generate-script", attemptNumber, attemptStartedAt, lastError);
        messages.push(
          { role: "assistant", content: raw },
          { role: "user", content: `生成结果未通过确定性校验，请按路径修正后只返回合法 JSON（仅 episodes 与 adaptation_notes）：\n${lastError}` },
        );
        continue;
      }

      const repairedRefs = validation.quality_report?.repaired_refs ?? [];
      const warningFindings = retryableWarnings(validation.warnings);
      if ((repairedRefs.length > 0 || warningFindings.length > 0) && attempt < this.maxRetries) {
        const feedbackParts: string[] = [];
        if (repairedRefs.length > 0) {
          feedbackParts.push(`以下 source_refs 不存在、已被自动剔除，请改用合法段落 ID 重新引用：${repairedRefs.join(", ")}`);
        }
        if (warningFindings.length > 0) {
          feedbackParts.push(formatGenerationFeedback(warningFindings));
        }
        lastError = feedbackParts.join("\n");
        this.logAttemptRetry("generate-script", attemptNumber, attemptStartedAt, lastError);
        messages.push(
          { role: "assistant", content: raw },
          { role: "user", content: `生成结果可解析但质量不足，请增强 source_refs、开场钩子、结尾悬念与规划一致性后只返回合法 JSON（仅 episodes 与 adaptation_notes）：\n${lastError}` },
        );
        continue;
      }

      const finalScript = validatedScript ?? schemaResult.data;
      this.logAttempt("generate-script", "success", attemptNumber, { elapsed_ms: Date.now() - attemptStartedAt });
      return { script_json: finalScript, script_yaml: scriptToYaml(finalScript) };
    }
    throw new Error(`live 生成在 ${this.maxRetries + 1} 次尝试后仍未产出合法剧本：${lastError}`);
  }

  /** Generate every planned episode in parallel, then assemble + validate the whole script. */
  private async generateByEpisode(input: GenerateInput, analysis: AnalyzeResult, plan: PlanScenesResult): Promise<GenerateScriptResult> {
    const scenesByEpisode = new Map<number, PlanScenesResult["scene_plan"]>();
    for (const scene of plan.scene_plan) {
      const arr = scenesByEpisode.get(scene.episode_no) ?? [];
      arr.push(scene);
      scenesByEpisode.set(scene.episode_no, arr);
    }
    const episodes = await Promise.all(
      plan.episodes.map((ep) => this.generateOneEpisode(input, analysis, plan, ep, scenesByEpisode.get(ep.episode_no) ?? [])),
    );
    episodes.sort((a, b) => a.episode_no - b.episode_no);

    const partial = { episodes, adaptation_notes: deriveAdaptationNotes(plan, analysis) };
    const assembled = assembleScript(input, analysis, partial);
    const canonical = {
      paragraphIds: (input.source_paragraphs ?? []).map((paragraph) => paragraph.id),
      fingerprint: input.source_fingerprint,
    };
    const validation = validateScriptObject(assembled, { mode: "generate", canonical });
    if (!validation.valid || !validation.script) {
      throw new Error(`按集生成装配后整体校验失败：${formatGenerationFeedback(validation.errors)}`);
    }
    return { script_json: validation.script, script_yaml: scriptToYaml(validation.script) };
  }

  /** Generate one episode from its plan slice, validating structure + refs + plan adherence, with retry. */
  private async generateOneEpisode(
    input: GenerateInput,
    analysis: AnalyzeResult,
    plan: PlanScenesResult,
    plannedEpisode: PlanScenesResult["episodes"][number],
    plannedScenes: PlanScenesResult["scene_plan"],
  ): Promise<Script["episodes"][number]> {
    const messages: ChatMessage[] = [...buildEpisodeMessages(input, analysis, plannedEpisode, plannedScenes)];
    const planSubset = { ...plan, episodes: [plannedEpisode], scene_plan: plannedScenes };
    let lastError = "";
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const attemptNumber = attempt + 1;
      const attemptStartedAt = Date.now();
      const raw = await this.completeAttempt("generate-script", messages, attemptNumber, attemptStartedAt);
      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJson(raw));
      } catch (e) {
        lastError = `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`;
        this.logAttemptRetry("generate-script", attemptNumber, attemptStartedAt, lastError);
        messages.push({ role: "assistant", content: raw }, { role: "user", content: `${lastError}。只返回该集合法 JSON。` });
        continue;
      }
      const result = EpisodeSchema.safeParse(parsed);
      if (!result.success) {
        lastError = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
        this.logAttemptRetry("generate-script", attemptNumber, attemptStartedAt, lastError);
        messages.push({ role: "assistant", content: raw }, { role: "user", content: `第 ${plannedEpisode.episode_no} 集结构不合法：${lastError}。只返回该集合法 JSON。` });
        continue;
      }
      const episode = result.data;
      const mini = assembleScript(input, analysis, { episodes: [episode], adaptation_notes: [] }) as Script;
      const findings = [...checkReferential(mini), ...checkGeneratedScriptAgainstPlan(mini, planSubset as PlanScenesResult)];
      if (findings.length === 0) {
        this.logAttempt("generate-script", "success", attemptNumber, { elapsed_ms: Date.now() - attemptStartedAt });
        return episode;
      }
      lastError = formatGenerationFeedback(findings);
      this.logAttemptRetry("generate-script", attemptNumber, attemptStartedAt, lastError);
      messages.push(
        { role: "assistant", content: raw },
        { role: "user", content: `第 ${plannedEpisode.episode_no} 集未通过校验，请按路径修正后只返回该集合法 JSON：\n${lastError}` },
      );
    }
    throw new Error(`第 ${plannedEpisode.episode_no} 集生成在 ${this.maxRetries + 1} 次尝试后仍不合法：${lastError}`);
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

/** Derive adaptation_notes deterministically from the plan (omitted events → cut notes; strategy → pacing). */
function deriveAdaptationNotes(plan: PlanScenesResult, analysis: AnalyzeResult): Array<{ type: string; description: string; source_refs?: string[] }> {
  const notes: Array<{ type: string; description: string; source_refs?: string[] }> = [];
  const eventById = new Map(analysis.key_events.map((e) => [e.id, e]));
  for (const omittedId of plan.coverage.omitted_event_ids) {
    const ev = eventById.get(omittedId);
    if (ev) notes.push({ type: "cut", description: `未改编关键事件：${ev.summary}`, source_refs: ev.source_refs });
  }
  if (plan.adaptation_strategy.trim().length > 0) {
    notes.push({ type: "pacing", description: plan.adaptation_strategy });
  }
  return notes;
}

/** Construct a live provider from env config (call only when hasApiKey()). */
export function createLiveProvider(): LiveLLMProvider {
  const config = getLlmConfig();
  return new LiveLLMProvider(makeComplete(config), config.maxRetries);
}
