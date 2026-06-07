# Generation Validation & Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the final script generation stage retry against deterministic validation and plan-adherence feedback, so live LLM outputs are not accepted merely because they satisfy the loose top-level Zod schema.

**Architecture:** Keep the existing final YAML schema unchanged. Add a small generation-feedback helper that formats full validation errors/warnings and checks whether generated episodes/scenes honor the planning output. Wire this helper into `LiveLLMProvider.generateScript` so the model receives precise path-based feedback before retrying.

**Tech Stack:** TypeScript strict mode, existing `validateScriptObject`, existing `ScriptSchema`, existing `PlanScenesResult`, Vitest.

---

## Scope

Implement only:

- Full deterministic validation inside `LiveLLMProvider.generateScript`.
- Plan-adherence checks between `PlanScenesResult` and generated `Script`.
- Error/warning formatting for model feedback.
- Retry on hard validation errors, plan-adherence errors, and selected generation warnings.
- Focused tests for generation feedback and live provider retries.

Do not implement:

- New screenplay YAML fields.
- Storyboard shot list.
- Video prompt pack.
- New UI panels.
- Long-novel chunking.
- Provider selection changes.

## Current Situation

Current generation flow:

1. `LiveLLMProvider.generateScript` asks the model for creative `episodes` and `adaptation_notes`.
2. It assembles a full `Script` with system-owned metadata/source/entities.
3. It only runs `ScriptSchema.safeParse`.
4. `/api/generate-script` later runs `validateScriptObject`.

Problem:

- The live model does not see full validation failures such as invalid references, anchor mismatch, integrity failures, weak traceability, or short-drama constraint warnings.
- The generated screenplay is not checked against `plan.scene_plan`.
- Plan fields such as `purpose`, `conflict`, `required_character_ids`, `event_ids`, and `source_refs` are present in the prompt but not enforced after generation.

Desired flow:

1. Assemble the script.
2. Run `validateScriptObject(..., { mode: "generate", canonical })`.
3. Check generated scenes against the plan.
4. If hard errors exist, feed precise feedback to the model and retry.
5. If selected warnings exist and retry attempts remain, feed improvement feedback and retry.
6. On the last warning-only attempt, return the valid script with warnings preserved by the API route.

---

## File Map

Create:

- `src/llm/generation-feedback.ts`  
  Pure helper for plan adherence checks and feedback text formatting.

- `tests/core/generation-feedback.test.ts`  
  Focused tests for plan adherence and feedback formatting.

Modify:

- `src/llm/live-provider.ts`  
  Import `validateScriptObject` and generation-feedback helpers. Replace schema-only retry with full validation + plan feedback retry.

- `tests/core/live-provider.test.ts`  
  Add tests for invalid refs retry, weak traceability retry, and plan-adherence retry.

- `tests/integration/fixture-pipeline.test.ts`  
  Assert fixture generation remains valid after the provider-level validation change.

No changes expected:

- `src/core/schema/script-schema.ts`
- `src/core/validate/full.ts`
- `src/app/api/generate-script/route.ts`

The route may keep re-validating the provider output. That duplication is acceptable and keeps the API robust for fixture mode and future providers.

---

## Task 1: Add Generation Feedback Helper

**Files:**
- Create: `src/llm/generation-feedback.ts`
- Create: `tests/core/generation-feedback.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/core/generation-feedback.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkGeneratedScriptAgainstPlan, formatGenerationFeedback, retryableGenerationWarnings } from "../../src/llm/generation-feedback";
import type { Script } from "../../src/core/schema/script-schema";
import type { PlanScenesResult } from "../../src/llm/provider";
import type { ValidationItem } from "../../src/core/validate/schema-validate";

const script: Script = {
  schema_version: "1.0",
  metadata: {
    title: "测试",
    source_type: "novel",
    target_format: "screenplay",
    adaptation_profile: "short_drama",
    language: "zh-CN",
    created_at: "2026-06-07T00:00:00.000Z",
    generator: { model: "test", mode: "live" },
    source_fingerprint: "fp",
  },
  adaptation_constraints: {
    structure_unit: "episode",
    episode_count: 1,
    target_duration_seconds_per_episode: 120,
    opening_hook_required: true,
    cliffhanger_required: true,
    fidelity_level: "balanced",
  },
  source_chapters: [{ id: "ch1", title: "归港", index: 1, summary: "x" }],
  source_paragraphs: [{ id: "ch1_p1_a", chapter_id: "ch1", paragraph_index: 1, text_preview: "x", hash: "a" }],
  characters: [{ id: "char_lin", name: "林深", aliases: [], role: "protagonist", motivation: "x", relationship_notes: "x", source_refs: ["ch1_p1_a"] }],
  locations: [{ id: "loc_dock", name: "旧码头", description: "x", source_refs: ["ch1_p1_a"] }],
  episodes: [{
    episode_no: 1,
    title: "归来",
    opening_hook: "他回来了",
    core_conflict: "追查真相",
    cliffhanger: "灯灭",
    estimated_duration_seconds: 120,
    scenes: [{
      scene_no: 1,
      heading: { int_ext: "EXT", location_id: "loc_dock", time_of_day: "NIGHT" },
      present_character_ids: ["char_lin"],
      summary: "登岸",
      beats: [{ beat_no: 1, type: "action", description: "林深踏上旧码头。", source_refs: ["ch1_p1_a"] }],
      source_refs: ["ch1_p1_a"],
    }],
  }],
  adaptation_notes: [],
  quality_report: {
    source_coverage_ratio: 1,
    referenced_paragraph_count: 1,
    total_paragraph_count: 1,
    missing_source_refs: [],
    repaired_refs: [],
    untraceable_scenes: [],
    unreferenced_key_paragraphs: [],
    constraint_warnings: [],
    manual_review_suggestions: [],
  },
};

const plan: PlanScenesResult = {
  episodes: [{
    episode_no: 1,
    title: "归来",
    opening_hook: "h",
    main_goal: "确认线索",
    core_conflict: "追查真相",
    turning_point: "灯灭",
    cliffhanger: "cl",
    estimated_duration_seconds: 120,
    event_ids: ["evt_1"],
    source_refs: ["ch1_p1_a"],
  }],
  scene_plan: [{
    episode_no: 1,
    scene_no: 1,
    location_id: "loc_dock",
    purpose: "建立归港钩子",
    conflict: "林深被旧案刺痛",
    emotional_shift: "克制 -> 警觉",
    required_character_ids: ["char_lin"],
    event_ids: ["evt_1"],
    source_refs: ["ch1_p1_a"],
    summary: "林深归港。",
  }],
  coverage: { covered_event_ids: ["evt_1"], omitted_event_ids: [], coverage_ratio: 1 },
  pacing_notes: [],
  adaptation_strategy: "balanced",
};

describe("checkGeneratedScriptAgainstPlan", () => {
  it("accepts a generated script that follows the planned scene location, characters, and refs", () => {
    expect(checkGeneratedScriptAgainstPlan(script, plan)).toEqual([]);
  });

  it("reports missing planned scenes", () => {
    const broken: Script = { ...script, episodes: [{ ...script.episodes[0]!, scenes: [] }] };
    expect(checkGeneratedScriptAgainstPlan(broken, plan)).toEqual([
      {
        path: "episodes[0].scenes",
        code: "PLAN_ADHERENCE",
        message: "缺少规划场景：第 1 集第 1 场（建立归港钩子）",
      },
    ]);
  });

  it("reports scene location, character, and source-ref drift", () => {
    const broken: Script = {
      ...script,
      episodes: [{
        ...script.episodes[0]!,
        scenes: [{
          ...script.episodes[0]!.scenes[0]!,
          heading: { ...script.episodes[0]!.scenes[0]!.heading, location_id: "loc_other" },
          present_character_ids: [],
          source_refs: [],
          beats: [{ beat_no: 1, type: "action", description: "无出处动作。", source_refs: [] }],
        }],
      }],
    };
    expect(checkGeneratedScriptAgainstPlan(broken, plan)).toEqual([
      {
        path: "episodes[0].scenes[0].heading.location_id",
        code: "PLAN_ADHERENCE",
        message: "生成场景地点 loc_other 与规划地点 loc_dock 不一致",
      },
      {
        path: "episodes[0].scenes[0].present_character_ids",
        code: "PLAN_ADHERENCE",
        message: "生成场景缺少规划要求人物：char_lin",
      },
      {
        path: "episodes[0].scenes[0].source_refs",
        code: "PLAN_ADHERENCE",
        message: "生成场景未覆盖规划 source_refs：ch1_p1_a",
      },
    ]);
  });
});

describe("formatGenerationFeedback", () => {
  it("formats errors and retryable warnings with paths", () => {
    const items: ValidationItem[] = [
      { path: "episodes[0].scenes[0].beats[0].source_refs[0]", code: "INVALID_SOURCE_REF", message: "source_ref 不存在：bad" },
      { path: "quality_report.source_coverage_ratio", code: "WEAK_TRACEABILITY", message: "原文覆盖率偏低：0%" },
    ];
    expect(formatGenerationFeedback(items)).toContain("INVALID_SOURCE_REF @ episodes[0].scenes[0].beats[0].source_refs[0]");
    expect(formatGenerationFeedback(items)).toContain("WEAK_TRACEABILITY @ quality_report.source_coverage_ratio");
  });

  it("defines the warning codes that should trigger a retry before the final attempt", () => {
    expect(retryableGenerationWarnings.has("WEAK_TRACEABILITY")).toBe(true);
    expect(retryableGenerationWarnings.has("CONSTRAINT_WARNING")).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm test -- tests/core/generation-feedback.test.ts
```

Expected: FAIL because `src/llm/generation-feedback.ts` does not exist.

- [ ] **Step 3: Implement `generation-feedback.ts`**

Create `src/llm/generation-feedback.ts`:

```ts
import type { Script } from "../core/schema/script-schema";
import type { ValidationItem } from "../core/validate/schema-validate";
import type { PlanScenesResult } from "./provider";

export const retryableGenerationWarnings = new Set(["WEAK_TRACEABILITY", "CONSTRAINT_WARNING"]);

function sceneRefs(scene: Script["episodes"][number]["scenes"][number]): Set<string> {
  return new Set([
    ...scene.source_refs,
    ...scene.beats.flatMap((beat) => beat.source_refs),
  ]);
}

function episodeIndexByNo(script: Script, episodeNo: number): number {
  return script.episodes.findIndex((episode) => episode.episode_no === episodeNo);
}

function sceneIndexByNo(script: Script, episodeIndex: number, sceneNo: number): number {
  return script.episodes[episodeIndex]?.scenes.findIndex((scene) => scene.scene_no === sceneNo) ?? -1;
}

export function checkGeneratedScriptAgainstPlan(script: Script, plan: PlanScenesResult): ValidationItem[] {
  const findings: ValidationItem[] = [];

  for (const plannedScene of plan.scene_plan) {
    const episodeIndex = episodeIndexByNo(script, plannedScene.episode_no);
    if (episodeIndex < 0) {
      findings.push({
        path: "episodes",
        code: "PLAN_ADHERENCE",
        message: `缺少规划集：第 ${plannedScene.episode_no} 集`,
      });
      continue;
    }

    const sceneIndex = sceneIndexByNo(script, episodeIndex, plannedScene.scene_no);
    if (sceneIndex < 0) {
      findings.push({
        path: `episodes[${episodeIndex}].scenes`,
        code: "PLAN_ADHERENCE",
        message: `缺少规划场景：第 ${plannedScene.episode_no} 集第 ${plannedScene.scene_no} 场（${plannedScene.purpose}）`,
      });
      continue;
    }

    const scene = script.episodes[episodeIndex]!.scenes[sceneIndex]!;
    if (scene.heading.location_id !== plannedScene.location_id) {
      findings.push({
        path: `episodes[${episodeIndex}].scenes[${sceneIndex}].heading.location_id`,
        code: "PLAN_ADHERENCE",
        message: `生成场景地点 ${scene.heading.location_id} 与规划地点 ${plannedScene.location_id} 不一致`,
      });
    }

    const missingCharacters = plannedScene.required_character_ids.filter((id) => !scene.present_character_ids.includes(id));
    if (missingCharacters.length > 0) {
      findings.push({
        path: `episodes[${episodeIndex}].scenes[${sceneIndex}].present_character_ids`,
        code: "PLAN_ADHERENCE",
        message: `生成场景缺少规划要求人物：${missingCharacters.join(", ")}`,
      });
    }

    const refs = sceneRefs(scene);
    const missingRefs = plannedScene.source_refs.filter((ref) => !refs.has(ref));
    if (missingRefs.length > 0) {
      findings.push({
        path: `episodes[${episodeIndex}].scenes[${sceneIndex}].source_refs`,
        code: "PLAN_ADHERENCE",
        message: `生成场景未覆盖规划 source_refs：${missingRefs.join(", ")}`,
      });
    }
  }

  return findings;
}

export function retryableWarnings(warnings: ValidationItem[]): ValidationItem[] {
  return warnings.filter((warning) => retryableGenerationWarnings.has(warning.code));
}

export function formatGenerationFeedback(items: ReadonlyArray<ValidationItem>): string {
  return items
    .map((item) => `${item.code} @ ${item.path || "root"}: ${item.message}`)
    .join("\n");
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
npm test -- tests/core/generation-feedback.test.ts
```

Expected: PASS.

---

## Task 2: Wire Full Validation into Live Generate Retry

**Files:**
- Modify: `src/llm/live-provider.ts`
- Modify: `tests/core/live-provider.test.ts`

- [ ] **Step 1: Add failing live-provider tests**

Append these tests inside `describe("LiveLLMProvider.generateScript", () => { ... })` in `tests/core/live-provider.test.ts`:

```ts
it("retries when full validation reports an invalid source_ref", async () => {
  let i = 0;
  const bad = JSON.stringify({
    episodes: [{
      episode_no: 1,
      title: "坏引用",
      opening_hook: "他回来了",
      core_conflict: "真相",
      cliffhanger: "灯灭",
      estimated_duration_seconds: 120,
      scenes: [{
        scene_no: 1,
        heading: { int_ext: "EXT", location_id: "loc_dock", time_of_day: "NIGHT" },
        present_character_ids: ["char_lin"],
        summary: "登岸",
        beats: [{ beat_no: 1, type: "action", source_refs: ["bad_ref"], description: "林深踏上栈桥。" }],
        source_refs: ["bad_ref"],
      }],
    }],
    adaptation_notes: [],
  });
  const responses = [bad, creativeJson];
  const complete: CompleteFn = async () => responses[Math.min(i++, responses.length - 1)]!;
  const provider = new LiveLLMProvider(complete, 2);
  const out = await provider.generateScript({ ...source, analysis, plan } as GenerateInput);
  expect(out.script_json.episodes[0]!.title).toBe("归来");
  expect(i).toBe(2);
});

it("retries when generated scenes do not follow the plan", async () => {
  let i = 0;
  const planned: PlanScenesResult = {
    episodes: [{
      episode_no: 1,
      title: "归来",
      opening_hook: "他回来了",
      main_goal: "确认线索",
      core_conflict: "真相",
      turning_point: "灯灭",
      cliffhanger: "灯灭",
      estimated_duration_seconds: 120,
      event_ids: ["evt_return"],
      source_refs: ["ch1_p1_aaaa1111"],
    }],
    scene_plan: [{
      episode_no: 1,
      scene_no: 1,
      location_id: "loc_dock",
      purpose: "建立归港钩子",
      conflict: "试探",
      emotional_shift: "平静 -> 警觉",
      required_character_ids: ["char_lin"],
      event_ids: ["evt_return"],
      source_refs: ["ch1_p1_aaaa1111"],
      summary: "登岸",
    }],
    coverage: { covered_event_ids: ["evt_return"], omitted_event_ids: [], coverage_ratio: 1 },
    pacing_notes: [],
    adaptation_strategy: "",
  };
  const bad = JSON.stringify({
    episodes: [{
      episode_no: 1,
      title: "偏离规划",
      opening_hook: "他回来了",
      core_conflict: "真相",
      cliffhanger: "灯灭",
      estimated_duration_seconds: 120,
      scenes: [{
        scene_no: 1,
        heading: { int_ext: "EXT", location_id: "loc_dock", time_of_day: "NIGHT" },
        present_character_ids: [],
        summary: "登岸",
        beats: [{ beat_no: 1, type: "action", source_refs: [], description: "林深踏上栈桥。" }],
        source_refs: [],
      }],
    }],
    adaptation_notes: [],
  });
  const responses = [bad, creativeJson];
  const complete: CompleteFn = async () => responses[Math.min(i++, responses.length - 1)]!;
  const provider = new LiveLLMProvider(complete, 2);
  const out = await provider.generateScript({ ...source, analysis, plan: planned } as GenerateInput);
  expect(out.script_json.episodes[0]!.title).toBe("归来");
  expect(i).toBe(2);
});

it("retries weak traceability warnings when attempts remain", async () => {
  let i = 0;
  const weak = JSON.stringify({
    episodes: [{
      episode_no: 1,
      title: "弱溯源",
      opening_hook: "他回来了",
      core_conflict: "真相",
      cliffhanger: "灯灭",
      estimated_duration_seconds: 120,
      scenes: [{
        scene_no: 1,
        heading: { int_ext: "EXT", location_id: "loc_dock", time_of_day: "NIGHT" },
        present_character_ids: ["char_lin"],
        summary: "登岸",
        beats: [{ beat_no: 1, type: "action", source_refs: [], description: "林深踏上栈桥。" }],
        source_refs: [],
      }],
    }],
    adaptation_notes: [],
  });
  const responses = [weak, creativeJson];
  const complete: CompleteFn = async () => responses[Math.min(i++, responses.length - 1)]!;
  const provider = new LiveLLMProvider(complete, 2);
  const out = await provider.generateScript({ ...source, analysis, plan } as GenerateInput);
  expect(out.script_json.episodes[0]!.title).toBe("归来");
  expect(i).toBe(2);
});
```

- [ ] **Step 2: Run live-provider tests and verify failure**

Run:

```bash
npm test -- tests/core/live-provider.test.ts
```

Expected: FAIL because `generateScript` still only uses `ScriptSchema.safeParse` and does not retry full validation/plan warnings.

- [ ] **Step 3: Import validation and feedback helpers**

At the top of `src/llm/live-provider.ts`, add:

```ts
import { validateScriptObject } from "../core/validate/full";
import {
  checkGeneratedScriptAgainstPlan,
  formatGenerationFeedback,
  retryableWarnings,
} from "./generation-feedback";
```

- [ ] **Step 4: Replace the success branch in `generateScript`**

Inside `generateScript`, after:

```ts
const assembled = assembleScript(input, input.analysis, partial);
```

replace the `ScriptSchema.safeParse(assembled)` block with this logic:

```ts
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
const planFindings = validatedScript ? checkGeneratedScriptAgainstPlan(validatedScript, input.plan) : [];
const hardFindings = [...validation.errors, ...planFindings];

if (hardFindings.length > 0) {
  lastError = formatGenerationFeedback(hardFindings);
  messages.push(
    { role: "assistant", content: raw },
    {
      role: "user",
      content: `生成结果未通过确定性校验，请按路径修正后只返回合法 JSON（仅 episodes 与 adaptation_notes）：\n${lastError}`,
    },
  );
  continue;
}

const warningFindings = retryableWarnings(validation.warnings);
if (warningFindings.length > 0 && attempt < this.maxRetries) {
  lastError = formatGenerationFeedback(warningFindings);
  messages.push(
    { role: "assistant", content: raw },
    {
      role: "user",
      content: `生成结果可解析但质量不足，请增强 source_refs、开场钩子、结尾悬念和规划一致性后只返回合法 JSON（仅 episodes 与 adaptation_notes）：\n${lastError}`,
    },
  );
  continue;
}

const finalScript = validatedScript ?? schemaResult.data;
return { script_json: finalScript, script_yaml: scriptToYaml(finalScript) };
```

Keep the final throw at the end of the retry loop unchanged.

- [ ] **Step 5: Run live-provider tests**

Run:

```bash
npm test -- tests/core/live-provider.test.ts tests/core/generation-feedback.test.ts
```

Expected: PASS.

---

## Task 3: Improve Feedback Coverage in Prompt Tests

**Files:**
- Modify: `tests/core/llm-prompts.test.ts`
- Modify: `src/llm/prompts.ts`

- [ ] **Step 1: Add prompt expectations for generation quality requirements**

In `tests/core/llm-prompts.test.ts`, inside the generate prompt test, add:

```ts
expect(joined).toContain("每个生成场景应对应一条 scene_plan");
expect(joined).toContain("source_refs");
expect(joined).toContain("main_goal");
expect(joined).toContain("emotional_shift");
```

- [ ] **Step 2: Run prompt tests**

Run:

```bash
npm test -- tests/core/llm-prompts.test.ts
```

Expected: PASS if the current prompt already contains these strings. If it fails, update `buildGenerateMessages` user content to include these exact constraints:

```ts
分集规划包含 main_goal / turning_point / event_ids / source_refs，生成时必须服务这些目标。
分场规划包含 purpose / conflict / emotional_shift / required_character_ids / event_ids / source_refs，每个生成场景应对应一条 scene_plan。
每个 scene 和关键 beat 都应尽量带 source_refs，source_refs 必须来自合法段落 ID。
```

- [ ] **Step 3: Run prompt tests again**

Run:

```bash
npm test -- tests/core/llm-prompts.test.ts
```

Expected: PASS.

---

## Task 4: Route-Level Regression Tests

**Files:**
- Modify: `tests/integration/fixture-pipeline.test.ts`
- No route code expected.

- [ ] **Step 1: Strengthen fixture pipeline assertion**

In `tests/integration/fixture-pipeline.test.ts`, after `validation.valid` assertion, add:

```ts
expect(generated.script_json.quality_report.source_coverage_ratio).toBeGreaterThanOrEqual(0);
expect(validation.errors).toEqual([]);
```

If `generated.script_json.quality_report` is still the placeholder in fixture mode, keep the assertion on route/API out of this test and only assert `validation.quality_report`. The fixture provider is allowed to return precomputed fixture YAML/JSON; the API route remains responsible for final recompute.

- [ ] **Step 2: Run fixture integration test**

Run:

```bash
npm test -- tests/integration/fixture-pipeline.test.ts
```

Expected: PASS.

---

## Task 5: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run full tests**

Run:

```bash
npm test
```

Expected: all test files pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Manual live-mode reasoning check**

Without spending real model calls, inspect `LiveLLMProvider.generateScript` and confirm:

1. Invalid JSON is fed back and retried.
2. Schema errors are fed back and retried.
3. `validateScriptObject` errors are fed back and retried.
4. `PLAN_ADHERENCE` errors are fed back and retried.
5. `WEAK_TRACEABILITY` / `CONSTRAINT_WARNING` warnings are retried while attempts remain.
6. Warning-only output on the final attempt is returned rather than thrown away.

- [ ] **Step 5: Commit**

Run:

```bash
git status --short
git add src/llm/generation-feedback.ts src/llm/live-provider.ts src/llm/prompts.ts tests/core/generation-feedback.test.ts tests/core/live-provider.test.ts tests/core/llm-prompts.test.ts tests/integration/fixture-pipeline.test.ts
git commit -m "feat(llm): feed validation errors back into generation"
```

Do not stage unrelated files such as `next-env.d.ts` or untracked plan documents unless intentionally including them.

---

## Acceptance Criteria

- `LiveLLMProvider.generateScript` no longer accepts schema-valid but deterministically invalid scripts.
- Full validation errors are included in retry feedback with `code @ path: message`.
- Generated scenes are checked against `plan.scene_plan`.
- Missing planned scenes, wrong scene locations, missing planned characters, and missing planned source refs trigger retry.
- Weak traceability and constraint warnings trigger retry while attempts remain.
- Final attempt can still return a valid script with warnings, preserving usability.
- The API route still recomputes validation and quality report before returning.
- `npm test`, `npm run typecheck`, and `npm run build` pass.

## Self-Review Notes

- Spec coverage: This plan covers full validation in generation, plan adherence, warning retry, prompt reinforcement, tests, and verification.
- Scope check: No storyboard/video generation is included.
- Type consistency: Reuses existing `Script`, `PlanScenesResult`, and `ValidationItem` types.
- Risk: The strictest new check is scene-to-plan matching by `episode_no` and `scene_no`. If live generation frequently changes scene numbering, relax matching later by episode + location + source overlap, but start strict because the prompt explicitly asks each generated scene to correspond to `scene_plan`.

