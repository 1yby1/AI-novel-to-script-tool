# Live Wiring — Implementation Plan (Plan 6, P1)

> **For agentic workers:** mechanical wiring of Plan 5's `LiveLLMProvider` into the app. Verified by typecheck + build + a fixture-mode dev smoke + the existing unit suite (routes are thin; logic is already unit-tested in Plans 1–5).

**Goal:** Make custom novels actually work end-to-end in the workbench when an OpenAI-compatible key is configured, while the keyless fixture demo keeps working unchanged. Wire `selectScriptProvider()` into the routes (re-parse posted `text`, thread staged context), update the UI to send `text` + analysis/plan and enable Generate in live mode, and document env config.

**Branch:** continue on `feat/live-llm` (Plan 6 builds directly on Plan 5's `src/llm/*`; ship as one "live LLM (core + wiring)" feature).

---

## Changes

### 1. `src/app/api/parse/route.ts` — add `mode` to the response
The UI needs to know whether live generation is available. Replace the file with:
```ts
import { NextResponse } from "next/server";
import { computeSourceFingerprint } from "../../../core/parse/fingerprint";
import { parseNovel } from "../../../core/parse/chapters";
import { hasApiKey } from "../../../llm/config";
import { jsonError, readJsonBody, stringField } from "../_lib/http";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await readJsonBody(request);
  if (!body) return jsonError("BAD_REQUEST", "请求体必须是 JSON 对象。");

  const text = stringField(body, "text");
  if (text === null) return jsonError("BAD_REQUEST", "`text` 必须是字符串。");

  const parsed = parseNovel(text);
  const mode = hasApiKey() && process.env.DEMO_MODE !== "fixture" ? "live" : "fixture";
  return NextResponse.json({
    ...parsed,
    source_fingerprint: computeSourceFingerprint(parsed.source_paragraphs),
    mode,
  });
}
```

### 2. `src/app/api/analyze/route.ts` — re-parse `text`, use `selectScriptProvider`
Replace the file with:
```ts
import { NextResponse } from "next/server";
import { parseNovel } from "../../../core/parse/chapters";
import { computeSourceFingerprint } from "../../../core/parse/fingerprint";
import { selectScriptProvider } from "../../../llm/get-provider";
import { jsonError, readJsonBody, stringField } from "../_lib/http";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await readJsonBody(request);
  if (!body) return jsonError("BAD_REQUEST", "请求体必须是 JSON 对象。");

  const text = stringField(body, "text");
  if (text === null) return jsonError("BAD_REQUEST", "`text` 必须是字符串。");

  const parsed = parseNovel(text);
  const source_fingerprint = computeSourceFingerprint(parsed.source_paragraphs);
  try {
    const result = await selectScriptProvider().analyze({
      source_fingerprint,
      chapters: parsed.chapters,
      source_paragraphs: parsed.source_paragraphs,
    });
    return NextResponse.json(result);
  } catch (e) {
    return jsonError("PROVIDER_ERROR", e instanceof Error ? e.message : String(e), 502);
  }
}
```

### 3. `src/app/api/plan-scenes/route.ts` — thread `analysis`
Replace the file with:
```ts
import { NextResponse } from "next/server";
import { parseNovel } from "../../../core/parse/chapters";
import { computeSourceFingerprint } from "../../../core/parse/fingerprint";
import { selectScriptProvider } from "../../../llm/get-provider";
import type { AnalyzeResult } from "../../../llm/provider";
import { jsonError, readJsonBody, stringField } from "../_lib/http";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await readJsonBody(request);
  if (!body) return jsonError("BAD_REQUEST", "请求体必须是 JSON 对象。");

  const text = stringField(body, "text");
  if (text === null) return jsonError("BAD_REQUEST", "`text` 必须是字符串。");

  const parsed = parseNovel(text);
  const source_fingerprint = computeSourceFingerprint(parsed.source_paragraphs);
  try {
    const result = await selectScriptProvider().planScenes({
      source_fingerprint,
      chapters: parsed.chapters,
      source_paragraphs: parsed.source_paragraphs,
      analysis: body.analysis as AnalyzeResult | undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    return jsonError("PROVIDER_ERROR", e instanceof Error ? e.message : String(e), 502);
  }
}
```

### 4. `src/app/api/generate-script/route.ts` — thread `analysis`+`plan`, canonical from re-parse
Replace the file with:
```ts
import { NextResponse } from "next/server";
import { parseNovel } from "../../../core/parse/chapters";
import { computeSourceFingerprint } from "../../../core/parse/fingerprint";
import { scriptToYaml } from "../../../core/yaml/convert";
import { validateScriptObject } from "../../../core/validate/full";
import { selectScriptProvider } from "../../../llm/get-provider";
import type { AnalyzeResult, PlanScenesResult } from "../../../llm/provider";
import { jsonError, readJsonBody, stringField } from "../_lib/http";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await readJsonBody(request);
  if (!body) return jsonError("BAD_REQUEST", "请求体必须是 JSON 对象。");

  const text = stringField(body, "text");
  if (text === null) return jsonError("BAD_REQUEST", "`text` 必须是字符串。");

  const parsed = parseNovel(text);
  const source_fingerprint = computeSourceFingerprint(parsed.source_paragraphs);
  try {
    const generated = await selectScriptProvider().generateScript({
      source_fingerprint,
      chapters: parsed.chapters,
      source_paragraphs: parsed.source_paragraphs,
      analysis: body.analysis as AnalyzeResult | undefined,
      plan: body.plan as PlanScenesResult | undefined,
      created_at: new Date().toISOString(),
      model: process.env.MODEL_NAME?.trim() || "gpt-4o-mini",
    });
    const canonical = {
      paragraphIds: parsed.source_paragraphs.map((p) => p.id),
      fingerprint: source_fingerprint,
    };
    const validation_result = validateScriptObject(generated.script_json, { mode: "generate", canonical });
    const script_json = validation_result.script ?? generated.script_json;
    return NextResponse.json({
      script_json,
      script_yaml: scriptToYaml(script_json),
      validation_result,
      quality_report: validation_result.quality_report,
    });
  } catch (e) {
    return jsonError("PROVIDER_ERROR", e instanceof Error ? e.message : String(e), 502);
  }
}
```
(`validate-yaml` and `demo` routes are unchanged.)

### 5. `src/app/page.tsx` — send `text` + staged context; enable Generate in live mode
- Add `mode: "live" | "fixture"` to the `ParseResult` interface.
- `runAnalyze`: post `{ text: novelText }` (was `{ source_fingerprint }`).
- `runPlan`: post `{ text: novelText, analysis }`.
- `runGenerate`: post `{ text: novelText, analysis, plan }` (drop `source_paragraph_ids`).
- Add `const canRun = Boolean(parseResult?.checks.meets_minimum_chapters && (canUseFixture || parseResult?.mode === "live"));`
- Analyze button `disabled`: `isBusy || !canRun`. Generate button `disabled`: `isBusy || !plan || !canRun`.
- Replace the offline hint condition/text to show only in fixture mode for non-demo text, and show a "live 模式" info hint when `parseResult?.mode === "live"`.
- Status badge: show `live` / `离线 Demo` next to the fingerprint.

### 6. `README.md` — document live mode + env vars (replace the "What Works Now"/Setup sections to reflect live support; keep fixture default). Add an "Environment" section:
```md
## Environment (optional, enables live generation)

Copy `.env.example` to `.env.local` and set:

- `OPENAI_API_KEY` — an OpenAI-compatible key. When set (and `DEMO_MODE` is not `fixture`), custom novels are generated by the live LLM.
- `OPENAI_BASE_URL` — optional; point at any OpenAI-compatible endpoint (e.g. Qwen/DeepSeek).
- `MODEL_NAME` — optional; default `gpt-4o-mini`.
- `OPENAI_TIMEOUT_MS` / `LLM_MAX_RETRIES` — optional tuning.
- `DEMO_MODE=fixture` — force the offline fixture path even if a key is set.

Without a key, the workbench runs the built-in demo offline (the demo fingerprint is `68d7c2e2e2ec7e59`); custom text needs a key.
```

### 7. `.env.example` — refresh comments + add tuning vars:
```
# Live LLM is supported. With OPENAI_API_KEY set (and DEMO_MODE != fixture),
# custom novels are generated by the live model. Without a key, only the built-in
# demo runs (offline fixtures).
OPENAI_API_KEY=
OPENAI_BASE_URL=
MODEL_NAME=gpt-4o-mini
# Optional tuning:
# OPENAI_TIMEOUT_MS=60000
# LLM_MAX_RETRIES=2
# Force offline fixtures even with a key:
# DEMO_MODE=fixture
```

---

## Verification
1. `npm run typecheck` — exit 0.
2. `npm test` — existing 124 pass (no behavior change to the unit-tested core).
3. `npm run build` — succeeds.
4. **Fixture-mode dev smoke** (no key): start `npm run dev`; then
   - `GET /api/demo` → text; `POST /api/parse {text}` → `mode:"fixture"`, fingerprint `68d7…`;
   - `POST /api/analyze {text}` → demo analysis; `POST /api/plan-scenes {text,analysis}` → plan;
   - `POST /api/generate-script {text,analysis,plan}` → `validation_result.valid === true`, coverage 1.
   (Confirms the re-parse + provider selection + canonical wiring still drives the demo end-to-end.)
5. (Optional, manual) with a real key in `.env.local`, paste a custom 3-chapter novel and confirm live generate produces a schema-valid YAML.

## Self-Review notes
- The fixture path is preserved: routes re-parse `text` → fingerprint; `selectScriptProvider()` returns fixture without a key; the fixture provider still gates by fingerprint, so only the built-in demo returns baked results and custom text in fixture mode surfaces a clear error (or is gated off in the UI).
- Generate canonical is derived from the same server-side parse, so anchoring stays authoritative.
- No core/unit-tested module changes — only thin routes + UI + docs.
