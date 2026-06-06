# Live LLM Provider (core) — Implementation Plan (Plan 5, P1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real OpenAI-compatible `LiveLLMProvider` (analyze → plan → generate) with structured-output + validation-feedback retry + deterministic assembly, so arbitrary novels (not just the built-in demo) can be turned into a schema-valid screenplay — fully unit-tested with a fake LLM (no API key, no network in tests).

**Architecture:** A thin `complete(messages)` adapter over the OpenAI SDK (custom `baseURL`/timeout). A pure `callJson` helper validates LLM JSON against a Zod schema and retries by feeding the error back. `LiveLLMProvider` implements the existing `ScriptProvider`: `analyze` lets the LLM extract entities *without IDs*, then the deterministic `normalizeEntities` assigns IDs + builds the legal-ID catalog; `generateScript` has the LLM produce only the creative `episodes`/`adaptation_notes`, and the **system assembles** the full `Script` (authoritative metadata/constraints/chapters/paragraphs/characters/locations) and validates it with `ScriptSchema` inside the retry loop. Provider selection: live iff `OPENAI_API_KEY` present and `DEMO_MODE!=="fixture"`, else fixture.

**Tech Stack:** `openai` v6 (OpenAI-compatible, `response_format: { type: "json_object" }`), Zod v4, existing core, Vitest. Tests inject a fake `complete` — deterministic, CI-safe.

**Spec:** `docs/superpowers/specs/2026-06-05-novel2script-design.md` (v1.2) §9 (pipeline + LLM reliability/degradation) and §6.2 (system-owned entity IDs).

---

## Scope & boundaries

- **Plan 5 (this doc):** the live provider **core library** under `src/llm` + provider input-type extension + provider selection — all unit-tested with a fake LLM. It does **not** change route/UI behavior (the app keeps using the fixture provider until Plan 6 wires the source content through).
- **Plan 6 (next):** wire routes (`/api/analyze|plan-scenes|generate-script`) to re-parse the posted `text`, thread the prior-stage results, and call the selected provider; update the UI to send `text` + analysis/plan and enable Generate for custom text in live mode; README env docs + `.env.example`; degradation surfacing.

**Branch:** `feat/live-llm` (already created off merged `main`).

**Reused (do not redefine):** `Script`, `ScriptSchema`, `getProfileConstraints`, `normalizeEntities`, `scriptToYaml`, and the `AnalyzeResult`/`PlanScenesResult`/`GenerateScriptResult`/`ScriptProvider` contracts from `src/llm/provider.ts`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/llm/config.ts` | Read env (`OPENAI_API_KEY`/`OPENAI_BASE_URL`/`MODEL_NAME`/timeout/retries); `hasApiKey()` |
| `src/llm/json-llm.ts` | `ChatMessage`/`CompleteFn`, `extractJson`, `callJson` (validate + retry-with-feedback) |
| `src/llm/output-schemas.ts` | `RawAnalyzeSchema` (entities w/o IDs), `PlanSchema` for LLM stage outputs |
| `src/llm/prompts.ts` | `buildAnalyzeMessages` / `buildPlanMessages` / `buildGenerateMessages` (inject legal ID lists) |
| `src/llm/client.ts` | `makeComplete(config)` — OpenAI SDK adapter (json_object, timeout) |
| `src/llm/live-provider.ts` | `LiveLLMProvider` + `assembleScript` + `createLiveProvider()` |
| `src/llm/get-provider.ts` | `selectScriptProvider()` (live vs fixture by env) — not wired to routes until Plan 6 |
| `src/llm/provider.ts` | **extend** input types with optional source/context fields (additive) |
| `src/llm/fixture-provider.ts` | **update** method signatures to new input types (ignore extras; behavior unchanged) |

---

## Task 1: Add `openai` + LLM config

**Files:** `package.json`/lock; Create `src/llm/config.ts`, `tests/core/llm-config.test.ts`

- [ ] **Step 1: Install** — `npm install openai` (from project root). Expect `openai` (v6.x) under `dependencies`.

- [ ] **Step 2: Write the failing test** — `tests/core/llm-config.test.ts`

```ts
import { describe, it, expect, afterEach } from "vitest";
import { hasApiKey, getLlmConfig } from "../../src/llm/config";

const ORIGINAL = { ...process.env };
afterEach(() => { process.env = { ...ORIGINAL }; });

describe("llm config", () => {
  it("hasApiKey reflects OPENAI_API_KEY presence", () => {
    delete process.env.OPENAI_API_KEY;
    expect(hasApiKey()).toBe(false);
    process.env.OPENAI_API_KEY = "sk-test";
    expect(hasApiKey()).toBe(true);
  });

  it("getLlmConfig throws without a key", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => getLlmConfig()).toThrow();
  });

  it("getLlmConfig applies defaults and overrides", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.OPENAI_BASE_URL;
    delete process.env.MODEL_NAME;
    delete process.env.LLM_MAX_RETRIES;
    const a = getLlmConfig();
    expect(a.model).toBe("gpt-4o-mini");
    expect(a.maxRetries).toBe(2);
    expect(a.baseURL).toBeUndefined();

    process.env.OPENAI_BASE_URL = "https://example.com/v1";
    process.env.MODEL_NAME = "qwen-max";
    process.env.LLM_MAX_RETRIES = "1";
    const b = getLlmConfig();
    expect(b.baseURL).toBe("https://example.com/v1");
    expect(b.model).toBe("qwen-max");
    expect(b.maxRetries).toBe(1);
  });
});
```

- [ ] **Step 3: Run** `npx vitest run tests/core/llm-config.test.ts` — FAIL.

- [ ] **Step 4: Implement `src/llm/config.ts`**

```ts
export interface LlmConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
}

/** Whether a usable OpenAI-compatible API key is configured. */
export function hasApiKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0);
}

/** Read live-LLM config from env. Throws if no API key (call hasApiKey() first). */
export function getLlmConfig(): LlmConfig {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("缺少 OPENAI_API_KEY，无法使用 live 模式。");
  const retriesRaw = Number(process.env.LLM_MAX_RETRIES);
  const timeoutRaw = Number(process.env.OPENAI_TIMEOUT_MS);
  return {
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
    model: process.env.MODEL_NAME?.trim() || "gpt-4o-mini",
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 60000,
    maxRetries: Number.isFinite(retriesRaw) && retriesRaw >= 0 ? retriesRaw : 2,
  };
}
```

- [ ] **Step 4b: Run** `npx vitest run tests/core/llm-config.test.ts` — PASS (3).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/llm/config.ts tests/core/llm-config.test.ts
git commit -m "feat(llm): openai dep + live config (env-driven)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Extend provider input types (additive) + fixture signatures

**Files:** Modify `src/llm/provider.ts`, `src/llm/fixture-provider.ts`. No new test (existing integration test + typecheck guard).

- [ ] **Step 1: Edit `src/llm/provider.ts`** — add source-context imports + input types, and change the `ScriptProvider` method signatures. Replace the **first import line and the `ScriptProvider` interface** so the file reads:

At the very top, change:
```ts
import type { Script } from "../core/schema/script-schema";
```
to:
```ts
import type { Script } from "../core/schema/script-schema";
import type { SourceChapter, SourceParagraph as ParsedParagraph } from "../core/parse/chapters";
```

Then **replace** the `ScriptProvider` interface block:
```ts
export interface ScriptProvider {
  analyze(input: { source_fingerprint: string }): Promise<AnalyzeResult>;
  planScenes(input: { source_fingerprint: string }): Promise<PlanScenesResult>;
  generateScript(input: { source_fingerprint: string }): Promise<GenerateScriptResult>;
}
```
with:
```ts
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
```

- [ ] **Step 2: Edit `src/llm/fixture-provider.ts`** — widen the method parameter types (still gate by fingerprint, ignore the rest). Change the import line:
```ts
import type { AnalyzeResult, GenerateScriptResult, PlanScenesResult, ScriptProvider } from "./provider";
```
to:
```ts
import type { AnalyzeInput, AnalyzeResult, GenerateInput, GenerateScriptResult, PlanInput, PlanScenesResult, ScriptProvider } from "./provider";
```
Then change the three method signatures inside `class FixtureProvider`:
- `async analyze(input: { source_fingerprint: string }): Promise<AnalyzeResult> {` → `async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {`
- `async planScenes(input: { source_fingerprint: string }): Promise<PlanScenesResult> {` → `async planScenes(input: PlanInput): Promise<PlanScenesResult> {`
- `async generateScript(input: { source_fingerprint: string }): Promise<GenerateScriptResult> {` → `async generateScript(input: GenerateInput): Promise<GenerateScriptResult> {`

(The method bodies are unchanged — they read only `input.source_fingerprint`.)

- [ ] **Step 3: Verify nothing broke** — `npm test` (97 still pass; the fixture integration test calls `provider.analyze({ source_fingerprint })`, still valid since the new fields are optional) and `npm run typecheck` (exit 0).

- [ ] **Step 4: Commit**

```bash
git add src/llm/provider.ts src/llm/fixture-provider.ts
git commit -m "feat(llm): extend provider inputs with optional source context (additive)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: JSON extraction + retry helper (`json-llm.ts`)

**Files:** Create `src/llm/json-llm.ts`, `tests/core/json-llm.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/json-llm.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { extractJson, callJson, type CompleteFn } from "../../src/llm/json-llm";

describe("extractJson", () => {
  it("returns plain JSON unchanged", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });
  it("strips markdown fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("extracts the first balanced object from surrounding prose", () => {
    expect(extractJson('Sure! {"a":{"b":2}} done')).toBe('{"a":{"b":2}}');
  });
  it("ignores braces inside strings", () => {
    expect(extractJson('{"a":"}{"}')).toBe('{"a":"}{"}');
  });
});

const Schema = z.object({ name: z.string() });

function scripted(responses: string[]): { fn: CompleteFn; calls: () => number } {
  let i = 0;
  return {
    fn: async () => responses[Math.min(i++, responses.length - 1)]!,
    calls: () => i,
  };
}

describe("callJson", () => {
  it("returns validated data on first success", async () => {
    const s = scripted(['{"name":"林深"}']);
    const out = await callJson({ complete: s.fn, messages: [{ role: "user", content: "x" }], schema: Schema, label: "t" });
    expect(out.name).toBe("林深");
    expect(s.calls()).toBe(1);
  });

  it("retries with feedback after a bad response, then succeeds", async () => {
    const s = scripted(["not json", '{"name":"苏晚"}']);
    const out = await callJson({ complete: s.fn, messages: [{ role: "user", content: "x" }], schema: Schema, label: "t", maxRetries: 2 });
    expect(out.name).toBe("苏晚");
    expect(s.calls()).toBe(2);
  });

  it("throws after exhausting retries", async () => {
    const s = scripted(["nope"]);
    await expect(
      callJson({ complete: s.fn, messages: [{ role: "user", content: "x" }], schema: Schema, label: "t", maxRetries: 1 }),
    ).rejects.toThrow(/t/);
    expect(s.calls()).toBe(2); // initial + 1 retry
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/core/json-llm.test.ts` — FAIL.

- [ ] **Step 3: Implement `src/llm/json-llm.ts`**

```ts
import type { ZodType } from "zod";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type CompleteFn = (messages: ChatMessage[]) => Promise<string>;

/** Extract the first balanced JSON value from model output (strips ``` fences and prose). */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : text;
  const start = body.search(/[{[]/);
  if (start === -1) return body.trim();
  const open = body[start]!;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return body.slice(start).trim();
}

export interface CallJsonOptions<T> {
  complete: CompleteFn;
  messages: ChatMessage[];
  schema: ZodType<T>;
  label: string;
  maxRetries?: number;
}

/**
 * Call an LLM expecting JSON, validate against a Zod schema, and on parse/validation
 * failure feed the error back and retry (spec §9). Throws after maxRetries (default 2).
 */
export async function callJson<T>(opts: CallJsonOptions<T>): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  const messages: ChatMessage[] = [...opts.messages];
  let lastError = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const raw = await opts.complete(messages);
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch (e) {
      lastError = `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`;
      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: `${lastError}。请只返回合法 JSON，不要任何解释或 markdown 围栏。` });
      continue;
    }
    const result = opts.schema.safeParse(parsed);
    if (result.success) return result.data;
    lastError = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    messages.push({ role: "assistant", content: raw });
    messages.push({ role: "user", content: `输出不符合 ${opts.label} 结构：${lastError}。请修正并只返回合法 JSON。` });
  }
  throw new Error(`LLM ${opts.label} 在 ${maxRetries + 1} 次尝试后仍未产出合法结果：${lastError}`);
}
```

- [ ] **Step 4: Run** `npx vitest run tests/core/json-llm.test.ts` — PASS (7).

- [ ] **Step 5: Commit**

```bash
git add src/llm/json-llm.ts tests/core/json-llm.test.ts
git commit -m "feat(llm): json extraction + schema-validated retry helper" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: LLM stage output schemas (`output-schemas.ts`)

**Files:** Create `src/llm/output-schemas.ts`, `tests/core/llm-output-schemas.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/llm-output-schemas.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { RawAnalyzeSchema, PlanSchema } from "../../src/llm/output-schemas";

describe("RawAnalyzeSchema", () => {
  it("accepts entities without IDs (system assigns IDs)", () => {
    const r = RawAnalyzeSchema.safeParse({
      characters: [{ name: "林深", role: "protagonist" }],
      locations: [{ name: "旧码头" }],
      chapter_summaries: [{ chapter_id: "ch1", summary: "x" }],
      key_events: ["a"],
      conflicts: ["b"],
    });
    expect(r.success).toBe(true);
  });
  it("rejects a character without a name", () => {
    const r = RawAnalyzeSchema.safeParse({
      characters: [{ role: "minor" }],
      locations: [],
      chapter_summaries: [],
      key_events: [],
      conflicts: [],
    });
    expect(r.success).toBe(false);
  });
});

describe("PlanSchema", () => {
  it("accepts a minimal valid plan", () => {
    const r = PlanSchema.safeParse({
      episodes: [{ episode_no: 1, title: "t", opening_hook: "h", core_conflict: "c", cliffhanger: "cl", estimated_duration_seconds: 120, scene_refs: ["s1"] }],
      scene_plan: [{ episode_no: 1, scene_no: 1, location_id: "loc_x", summary: "s" }],
      pacing_notes: [],
      adaptation_strategy: "balanced",
    });
    expect(r.success).toBe(true);
  });
  it("rejects a non-integer episode_no", () => {
    const r = PlanSchema.safeParse({ episodes: [{ episode_no: 1.5, title: "t", opening_hook: "h", core_conflict: "c", cliffhanger: "cl", estimated_duration_seconds: 120, scene_refs: [] }], scene_plan: [], pacing_notes: [], adaptation_strategy: "x" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/core/llm-output-schemas.test.ts` — FAIL.

- [ ] **Step 3: Implement `src/llm/output-schemas.ts`**

```ts
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
```

- [ ] **Step 4: Run** — PASS (4).

- [ ] **Step 5: Commit**

```bash
git add src/llm/output-schemas.ts tests/core/llm-output-schemas.test.ts
git commit -m "feat(llm): zod schemas for analyze/plan stage outputs" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Prompts (`prompts.ts`)

**Files:** Create `src/llm/prompts.ts`, `tests/core/llm-prompts.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/llm-prompts.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildAnalyzeMessages, buildPlanMessages, buildGenerateMessages } from "../../src/llm/prompts";
import type { AnalyzeResult, PlanScenesResult, SourceContext } from "../../src/llm/provider";

const source: SourceContext = {
  source_fingerprint: "fp",
  chapters: [{ id: "ch1", title: "归港", index: 1 }],
  source_paragraphs: [
    { id: "ch1_p1_aaaa1111", chapter_id: "ch1", paragraph_index: 1, text: "林深回到旧码头。", text_preview: "林深回到旧码头。", hash: "aaaa1111" },
  ],
};
const analysis: AnalyzeResult = {
  characters: [{ id: "char_lin", name: "林深", aliases: [], role: "protagonist", motivation: "", relationship_notes: "", source_refs: ["ch1_p1_aaaa1111"] }],
  locations: [{ id: "loc_dock", name: "旧码头", description: "", source_refs: ["ch1_p1_aaaa1111"] }],
  entity_catalog: [{ id: "char_lin", name: "林深" }, { id: "loc_dock", name: "旧码头" }],
  chapter_summaries: [{ chapter_id: "ch1", summary: "归港" }],
  key_events: [],
  conflicts: [],
};
const plan: PlanScenesResult = {
  episodes: [{ episode_no: 1, title: "归来", opening_hook: "h", core_conflict: "c", cliffhanger: "cl", estimated_duration_seconds: 120, scene_refs: ["s1"] }],
  scene_plan: [{ episode_no: 1, scene_no: 1, location_id: "loc_dock", summary: "s" }],
  pacing_notes: [],
  adaptation_strategy: "balanced",
};

describe("prompts", () => {
  it("analyze injects the paragraph text and forbids inventing IDs", () => {
    const msgs = buildAnalyzeMessages(source);
    const joined = msgs.map((m) => m.content).join("\n");
    expect(joined).toContain("ch1_p1_aaaa1111");
    expect(joined).toContain("林深回到旧码头");
    expect(msgs[0]!.role).toBe("system");
  });
  it("plan injects the legal entity catalog and paragraph IDs", () => {
    const joined = buildPlanMessages(source, analysis).map((m) => m.content).join("\n");
    expect(joined).toContain("char_lin");
    expect(joined).toContain("loc_dock");
    expect(joined).toContain("ch1_p1_aaaa1111");
  });
  it("generate injects legal IDs and the prior plan", () => {
    const joined = buildGenerateMessages(source, analysis, plan).map((m) => m.content).join("\n");
    expect(joined).toContain("ch1_p1_aaaa1111");
    expect(joined).toContain("char_lin");
    expect(joined).toContain("schema_version");
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement `src/llm/prompts.ts`**

```ts
import type { ChatMessage } from "./json-llm";
import type { AnalyzeResult, PlanScenesResult, SourceContext } from "./provider";

const JSON_ONLY = "只返回一个合法 JSON 对象，不要 markdown 围栏、不要任何解释文字。";

function paragraphCatalog(source: SourceContext): string {
  return (source.source_paragraphs ?? []).map((p) => `${p.id}: ${p.text}`).join("\n");
}
function paragraphIdList(source: SourceContext): string {
  return (source.source_paragraphs ?? []).map((p) => p.id).join(", ");
}
function entityCatalog(analysis: AnalyzeResult): string {
  return [
    ...analysis.characters.map((c) => `${c.id}=${c.name}`),
    ...analysis.locations.map((l) => `${l.id}=${l.name}`),
  ].join(", ");
}

export function buildAnalyzeMessages(source: SourceContext): ChatMessage[] {
  return [
    {
      role: "system",
      content: `你是中文小说改编分析助手。基于带 ID 的原文段落，抽取人物、地点、章节摘要、关键事件、主要冲突。${JSON_ONLY} 人物/地点不要编造 ID（系统会分配）。source_refs 只能引用下方列出的段落 ID。`,
    },
    {
      role: "user",
      content: `原文段落（格式「ID: 正文」）：\n${paragraphCatalog(source)}\n\n输出 JSON：{"characters":[{"name":"","aliases":[],"role":"protagonist|antagonist|supporting|minor","motivation":"","relationship_notes":"","source_refs":[]}],"locations":[{"name":"","description":"","source_refs":[]}],"chapter_summaries":[{"chapter_id":"","summary":""}],"key_events":[],"conflicts":[]}`,
    },
  ];
}

export function buildPlanMessages(source: SourceContext, analysis: AnalyzeResult): ChatMessage[] {
  return [
    {
      role: "system",
      content: `你是短剧编剧。把小说改编为多集短剧结构，每集包含开场钩子、核心冲突、结尾悬念。${JSON_ONLY} location_id 只能用下方实体清单中的 ID。`,
    },
    {
      role: "user",
      content: `合法实体 ID：${entityCatalog(analysis)}\n合法段落 ID：${paragraphIdList(source)}\n章节摘要：${analysis.chapter_summaries.map((s) => `${s.chapter_id}:${s.summary}`).join(" | ")}\n\n输出 JSON：{"episodes":[{"episode_no":1,"title":"","opening_hook":"","core_conflict":"","cliffhanger":"","estimated_duration_seconds":120,"scene_refs":[]}],"scene_plan":[{"episode_no":1,"scene_no":1,"location_id":"","summary":""}],"pacing_notes":[],"adaptation_strategy":""}`,
    },
  ];
}

export function buildGenerateMessages(source: SourceContext, analysis: AnalyzeResult, plan: PlanScenesResult): ChatMessage[] {
  return [
    {
      role: "system",
      content: `你是短剧编剧，产出结构化剧本的【创意部分】 JSON。${JSON_ONLY} 严格遵守：source_refs 只能引用合法段落 ID；character_id 只能引用合法人物 ID；location_id 只能引用合法地点 ID；beats 为有序数组，每个 beat 的 type 为 dialogue|action|transition，且只包含该类型字段：dialogue={beat_no,type,source_refs,character_id,line,parenthetical?}；action={beat_no,type,source_refs,description}；transition={beat_no,type,source_refs,transition_kind}。系统会补全 metadata/source_paragraphs/quality_report 等，你只需产出 episodes 与 adaptation_notes。`,
    },
    {
      role: "user",
      content: `合法段落 ID：${paragraphIdList(source)}\n合法人物 ID：${analysis.characters.map((c) => c.id).join(", ")}\n合法地点 ID：${analysis.locations.map((l) => l.id).join(", ")}\n分集规划：${JSON.stringify(plan.episodes)}\n分场规划：${JSON.stringify(plan.scene_plan)}\n约束：短剧、每集约 120s、首集前 15 秒强钩子、每集结尾留悬念。\n\n（最终剧本顶层含 schema_version 等，但你只输出）JSON：{"episodes":[{"episode_no":1,"title":"","opening_hook":"","core_conflict":"","cliffhanger":"","estimated_duration_seconds":120,"scenes":[{"scene_no":1,"heading":{"int_ext":"INT|EXT|INT_EXT","location_id":"","time_of_day":"DAY|NIGHT|DAWN|DUSK|CONTINUOUS"},"present_character_ids":[],"summary":"","beats":[],"source_refs":[]}]}],"adaptation_notes":[{"type":"cut|merge|reorder|original_addition|pacing","description":"","source_refs":[]}]}`,
    },
  ];
}
```

- [ ] **Step 4: Run** — PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/llm/prompts.ts tests/core/llm-prompts.test.ts
git commit -m "feat(llm): staged prompts with legal ID-list injection (anti-hallucination)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: OpenAI client adapter (`client.ts`)

**Files:** Create `src/llm/client.ts`. (Thin network adapter — no unit test; exercised by live smoke + typecheck.)

- [ ] **Step 1: Implement `src/llm/client.ts`**

```ts
import OpenAI from "openai";
import type { LlmConfig } from "./config";
import type { ChatMessage, CompleteFn } from "./json-llm";

/**
 * Build a `complete(messages)` function over an OpenAI-compatible Chat Completions endpoint.
 * Requests JSON output and returns the raw assistant text (callJson handles parsing/retry).
 */
export function makeComplete(config: LlmConfig): CompleteFn {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
    maxRetries: config.maxRetries,
  });
  return async (messages: ChatMessage[]): Promise<string> => {
    const completion = await client.chat.completions.create({
      model: config.model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });
    return completion.choices[0]?.message?.content ?? "";
  };
}
```

- [ ] **Step 2: Typecheck** — `npm run typecheck` (exit 0). (No test; this is a thin adapter validated by typecheck and live smoke in Plan 6.)

- [ ] **Step 3: Commit**

```bash
git add src/llm/client.ts
git commit -m "feat(llm): openai-compatible chat client adapter (json_object)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: LiveLLMProvider (`live-provider.ts`)

**Files:** Create `src/llm/live-provider.ts`, `tests/core/live-provider.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/live-provider.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { LiveLLMProvider } from "../../src/llm/live-provider";
import type { CompleteFn } from "../../src/llm/json-llm";
import type { AnalyzeInput, GenerateInput, PlanInput } from "../../src/llm/provider";

const source = {
  source_fingerprint: "fp",
  chapters: [{ id: "ch1", title: "归港", index: 1 }],
  source_paragraphs: [
    { id: "ch1_p1_aaaa1111", chapter_id: "ch1", paragraph_index: 1, text: "林深回到旧码头。", text_preview: "林深回到旧码头。", hash: "aaaa1111" },
  ],
};

function fixedComplete(json: string): CompleteFn {
  return async () => json;
}

describe("LiveLLMProvider.analyze", () => {
  it("assigns deterministic entity IDs and builds the catalog", async () => {
    const json = JSON.stringify({
      characters: [{ name: "林深", role: "protagonist", source_refs: ["ch1_p1_aaaa1111", "ch9_bad"] }],
      locations: [{ name: "旧码头" }],
      chapter_summaries: [{ chapter_id: "ch1", summary: "归港" }],
      key_events: ["回港"],
      conflicts: ["真相"],
    });
    const provider = new LiveLLMProvider(fixedComplete(json));
    const r = await provider.analyze(source as AnalyzeInput);
    expect(r.characters[0]!.id).toMatch(/^char_/);
    expect(r.locations[0]!.id).toMatch(/^loc_/);
    expect(r.entity_catalog.length).toBe(2);
    // invalid source_ref filtered out; valid one kept
    expect(r.characters[0]!.source_refs).toEqual(["ch1_p1_aaaa1111"]);
    // missing optional fields coerced to schema-required shape
    expect(r.characters[0]!.motivation).toBe("");
  });

  it("throws when given no source paragraphs", async () => {
    const provider = new LiveLLMProvider(fixedComplete("{}"));
    await expect(provider.analyze({ source_fingerprint: "fp" } as AnalyzeInput)).rejects.toThrow();
  });
});

describe("LiveLLMProvider.generateScript", () => {
  const analysis = {
    characters: [{ id: "char_lin", name: "林深", aliases: [], role: "protagonist" as const, motivation: "", relationship_notes: "", source_refs: ["ch1_p1_aaaa1111"] }],
    locations: [{ id: "loc_dock", name: "旧码头", description: "", source_refs: ["ch1_p1_aaaa1111"] }],
    entity_catalog: [{ id: "char_lin", name: "林深" }, { id: "loc_dock", name: "旧码头" }],
    chapter_summaries: [{ chapter_id: "ch1", summary: "归港" }],
    key_events: [],
    conflicts: [],
  };
  const plan = { episodes: [], scene_plan: [], pacing_notes: [], adaptation_strategy: "" };
  const creativeJson = JSON.stringify({
    episodes: [{
      episode_no: 1, title: "归来", opening_hook: "他回来了", core_conflict: "真相", cliffhanger: "灯灭了", estimated_duration_seconds: 120,
      scenes: [{
        scene_no: 1,
        heading: { int_ext: "EXT", location_id: "loc_dock", time_of_day: "NIGHT" },
        present_character_ids: ["char_lin"],
        summary: "登岸",
        beats: [{ beat_no: 1, type: "action", source_refs: ["ch1_p1_aaaa1111"], description: "林深踏上栈桥。" }],
        source_refs: ["ch1_p1_aaaa1111"],
      }],
    }],
    adaptation_notes: [{ type: "merge", description: "合并船员", source_refs: ["ch1_p1_aaaa1111"] }],
  });

  it("assembles a schema-valid Script and emits YAML", async () => {
    const provider = new LiveLLMProvider(fixedComplete(creativeJson));
    const out = await provider.generateScript({ ...source, analysis, plan, created_at: "2026-06-06T00:00:00Z", model: "test-model" } as GenerateInput);
    expect(out.script_json.schema_version).toBe("1.0");
    expect(out.script_json.metadata.generator.mode).toBe("live");
    expect(out.script_json.metadata.source_fingerprint).toBe("fp");
    expect(out.script_json.episodes[0]!.scenes[0]!.beats[0]!.type).toBe("action");
    expect(out.script_json.source_paragraphs[0]!.id).toBe("ch1_p1_aaaa1111");
    expect(out.script_yaml).toContain("schema_version");
  });

  it("retries when the first creative output is structurally invalid", async () => {
    let i = 0;
    const responses = ['{"episodes":[{"episode_no":1}],"adaptation_notes":[]}', creativeJson]; // first lacks required episode fields
    const complete: CompleteFn = async () => responses[Math.min(i++, responses.length - 1)]!;
    const provider = new LiveLLMProvider(complete, 2);
    const out = await provider.generateScript({ ...source, analysis, plan } as GenerateInput);
    expect(out.script_json.episodes[0]!.title).toBe("归来");
    expect(i).toBe(2);
  });

  it("requires analysis and plan", async () => {
    const provider = new LiveLLMProvider(fixedComplete(creativeJson));
    await expect(provider.generateScript({ ...source } as GenerateInput)).rejects.toThrow();
  });
});

describe("LiveLLMProvider.planScenes", () => {
  it("validates and returns the plan", async () => {
    const planJson = JSON.stringify({
      episodes: [{ episode_no: 1, title: "t", opening_hook: "h", core_conflict: "c", cliffhanger: "cl", estimated_duration_seconds: 120, scene_refs: ["s1"] }],
      scene_plan: [{ episode_no: 1, scene_no: 1, location_id: "loc_dock", summary: "s" }],
      pacing_notes: [], adaptation_strategy: "balanced",
    });
    const analysis = { characters: [], locations: [], entity_catalog: [], chapter_summaries: [], key_events: [], conflicts: [] };
    const provider = new LiveLLMProvider(fixedComplete(planJson));
    const r = await provider.planScenes({ ...source, analysis } as PlanInput);
    expect(r.scene_plan).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/core/live-provider.test.ts` — FAIL.

- [ ] **Step 3: Implement `src/llm/live-provider.ts`**

```ts
import { ScriptSchema, type Script } from "../core/schema/script-schema";
import { getProfileConstraints } from "../core/schema/profiles";
import { normalizeEntities, type RawEntity } from "../core/entities/normalize-entities";
import { scriptToYaml } from "../core/yaml/convert";
import { getLlmConfig } from "./config";
import { makeComplete } from "./client";
import { callJson, extractJson, type ChatMessage, type CompleteFn } from "./json-llm";
import { RawAnalyzeSchema, PlanSchema } from "./output-schemas";
import { buildAnalyzeMessages, buildPlanMessages, buildGenerateMessages } from "./prompts";
import type {
  AnalyzeInput, AnalyzeResult, GenerateInput, GenerateScriptResult, PlanInput, PlanScenesResult, ScriptProvider,
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
        return { script_json: result.data, script_yaml: scriptToYaml(result.data) };
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
```

- [ ] **Step 4: Run** `npx vitest run tests/core/live-provider.test.ts` — PASS (6).

- [ ] **Step 5: Commit**

```bash
git add src/llm/live-provider.ts tests/core/live-provider.test.ts
git commit -m "feat(llm): LiveLLMProvider — entity-id normalization + assembled, validated generation with retry" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Provider selection (`get-provider.ts`)

**Files:** Create `src/llm/get-provider.ts`, `tests/core/get-provider.test.ts`. (Not wired into routes here — Plan 6.)

- [ ] **Step 1: Write the failing test** — `tests/core/get-provider.test.ts`

```ts
import { describe, it, expect, afterEach } from "vitest";
import { selectScriptProvider } from "../../src/llm/get-provider";
import { FixtureProvider } from "../../src/llm/fixture-provider";
import { LiveLLMProvider } from "../../src/llm/live-provider";

const ORIGINAL = { ...process.env };
afterEach(() => { process.env = { ...ORIGINAL }; });

describe("selectScriptProvider", () => {
  it("returns the fixture provider when no API key is set", () => {
    delete process.env.OPENAI_API_KEY;
    expect(selectScriptProvider()).toBeInstanceOf(FixtureProvider);
  });
  it("returns the live provider when a key is set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.DEMO_MODE;
    expect(selectScriptProvider()).toBeInstanceOf(LiveLLMProvider);
  });
  it("forces fixture when DEMO_MODE=fixture even with a key", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.DEMO_MODE = "fixture";
    expect(selectScriptProvider()).toBeInstanceOf(FixtureProvider);
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement `src/llm/get-provider.ts`**

```ts
import { hasApiKey } from "./config";
import { FixtureProvider } from "./fixture-provider";
import { createLiveProvider } from "./live-provider";
import type { ScriptProvider } from "./provider";

/**
 * Choose the provider by environment: live iff an OPENAI_API_KEY is present and
 * DEMO_MODE is not forced to "fixture"; otherwise the deterministic fixture provider.
 */
export function selectScriptProvider(): ScriptProvider {
  if (hasApiKey() && process.env.DEMO_MODE !== "fixture") {
    return createLiveProvider();
  }
  return new FixtureProvider();
}
```

- [ ] **Step 4: Run** — PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/llm/get-provider.ts tests/core/get-provider.test.ts
git commit -m "feat(llm): provider selection by env (live vs fixture)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Green gate

- [ ] **Step 1:** `npm test` — all pass. New: 3+0+7+4+3+6+3 = 26 on top of 97 ⇒ ~123 total across ~25 files.
- [ ] **Step 2:** `npm run typecheck` — exit 0.
- [ ] **Step 3:** `npm run build` — Next build succeeds (the new `src/llm` modules compile; routes/UI unchanged).
- [ ] **Step 4:** Commit if anything remains:
```bash
git status --short
# if needed: git add -A && git commit -m "test(llm): green gate for live provider core" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review — Spec Coverage (Plan 5 scope)

| Spec item | Covered by |
|---|---|
| §9 强制结构化输出（json_object）+ 围栏剥离 / 抽取首个 JSON | Task 6 client, Task 3 `extractJson` |
| §9 校验回灌重试（JSON/Zod 失败反馈重试） | Task 3 `callJson`, Task 7 generate loop |
| §9 超时（每次调用 timeout） | Task 1 config + Task 6 client |
| §9 确定性兜底（系统组装 Script，模型只产创意；最终 ScriptSchema 校验） | Task 7 `assembleScript` + generate loop |
| §6.2 系统拥有实体 ID（模型不编 ID） | Task 7 analyze → `normalizeEntities` |
| 反幻觉：注入合法段落/实体 ID 清单 | Task 5 prompts |
| Provider 选择（live/fixture by env，DEMO_MODE 强制 fixture） | Task 8 |

**Out of scope (Plan 6):** route wiring to post `text` + thread analysis/plan + call `selectScriptProvider`; UI sending source + enabling Generate for custom text in live mode + surfacing degradation; README env docs + `.env.example`; live smoke test with a real key.

**Type/name consistency:** `CompleteFn`/`ChatMessage` shared by `client`/`json-llm`/`live-provider`; `AnalyzeInput`/`PlanInput`/`GenerateInput`/`SourceContext` defined once in `provider.ts` and consumed by prompts + live-provider + fixture-provider; `AnalyzeResult.characters[].role` reused via the `Role` alias; `assembleScript` outputs exactly the 10 top-level keys `ScriptSchema` requires; fixture provider still satisfies the (widened) interface because new fields are optional. No placeholders.
