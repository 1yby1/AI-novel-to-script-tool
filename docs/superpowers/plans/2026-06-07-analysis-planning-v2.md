# Analysis & Planning v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the analyze and plan-scenes stages from loose summaries into structured, traceable dramaturgy artifacts that improve final screenplay quality without adding storyboard/video generation yet.

**Architecture:** Keep the existing staged pipeline and provider interface shape, but enrich `AnalyzeResult` and `PlanScenesResult` with event cards, conflict cards, relationship edges, hook candidates, scene purposes, event coverage, and source references. Fixture mode returns deterministic v2 JSON; live mode asks the LLM for raw names/refs, then normalizes names to system IDs and retries plan outputs that violate known IDs.

**Tech Stack:** Next.js route handlers, TypeScript strict mode, Zod 4, Vitest, existing OpenAI-compatible provider abstraction.

---

## Scope

Implement only:

- Analyze v2 structured output.
- Plan-scenes v2 structured output.
- Prompt updates so live mode asks for the new fields.
- Provider normalization so model outputs still use system-owned IDs.
- Fixture JSON updates for the built-in demo.
- UI display updates for the richer intermediate results.
- Tests covering schemas, prompts, live provider normalization, fixture pipeline, and typecheck/build.

Do not implement:

- Storyboard shot list.
- Video prompt pack.
- Video model API calls.
- Final screenplay YAML schema changes beyond consuming richer analysis/plan context during generation prompts.
- Long-novel chunking.

## Current Code Map

Existing files to modify:

- `src/llm/provider.ts`  
  Owns public TypeScript interfaces for `AnalyzeResult`, `PlanScenesResult`, and provider inputs.

- `src/llm/output-schemas.ts`  
  Owns Zod schemas for raw live LLM outputs in analyze and plan stages.

- `src/llm/prompts.ts`  
  Owns live-mode prompt assembly for analyze, plan, and generate stages.

- `src/llm/live-provider.ts`  
  Owns raw LLM calls, entity ID normalization, and full script assembly.

- `src/llm/fixture-provider.ts`  
  Reads deterministic fixture JSON and returns provider outputs.

- `fixtures/demo-analysis.json`  
  Must be upgraded from string arrays to structured analysis cards.

- `fixtures/demo-plan.json`  
  Must be upgraded with episode event IDs, scene purposes/conflicts/source refs, and deterministic coverage.

- `src/app/page.tsx`  
  Displays intermediate analysis and plan results in the workbench.

Existing tests to modify:

- `tests/core/llm-output-schemas.test.ts`
- `tests/core/llm-prompts.test.ts`
- `tests/core/live-provider.test.ts`
- `tests/integration/fixture-pipeline.test.ts`

New files to create:

- `src/llm/plan-consistency.ts`  
  Pure helpers for plan consistency checks and deterministic coverage recomputation. Keep this independent of Next.js and network APIs.

- `tests/core/plan-consistency.test.ts`  
  Unit tests for plan consistency and coverage helpers.

---

## Data Model

Use these names consistently across provider types, schemas, fixture data, prompts, UI, and tests.

### AnalyzeResult v2

Add these interfaces in `src/llm/provider.ts`:

```ts
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
```

Then change `AnalyzeResult` to:

```ts
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
```

### RawAnalyzeSchema v2

Live LLM analyze output should use names, not IDs, for extracted entities. IDs are system-owned.

Use this raw shape in `src/llm/output-schemas.ts`:

```ts
const RawEventCardSchema = z.object({
  id: z.string(),
  summary: z.string(),
  involved_character_names: z.array(z.string()).default([]),
  location_name: z.string().nullable().default(null),
  dramatic_function: z.enum(["hook", "setup", "conflict", "reversal", "climax", "resolution"]),
  source_refs: z.array(z.string()).default([]),
});

const RawConflictCardSchema = z.object({
  id: z.string(),
  parties: z.array(z.string()).default([]),
  surface_conflict: z.string(),
  underlying_tension: z.string(),
  stakes: z.string(),
  escalation: z.string(),
  source_refs: z.array(z.string()).default([]),
});

const RawRelationshipEdgeSchema = z.object({
  from_character_name: z.string(),
  to_character_name: z.string(),
  relation: z.string(),
  tension: z.string(),
  source_refs: z.array(z.string()).default([]),
});

const RawHookCandidateSchema = z.object({
  id: z.string(),
  description: z.string(),
  why_it_hooks: z.string(),
  suggested_episode_no: z.number().int().min(1),
  source_refs: z.array(z.string()).default([]),
});
```

Then include these in `RawAnalyzeSchema`:

```ts
key_events: z.array(RawEventCardSchema),
conflicts: z.array(RawConflictCardSchema),
relationship_edges: z.array(RawRelationshipEdgeSchema).default([]),
hook_candidates: z.array(RawHookCandidateSchema).default([]),
adaptation_warnings: z.array(z.string()).default([]),
```

Keep `characters`, `locations`, and `chapter_summaries` as they are, except leave `source_refs` defaults as empty arrays.

### PlanScenesResult v2

Add these interfaces in `src/llm/provider.ts`:

```ts
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
```

Then change `PlanScenesResult` to:

```ts
export interface PlanScenesResult {
  episodes: EpisodePlan[];
  scene_plan: ScenePlanEntry[];
  coverage: PlanCoverage;
  pacing_notes: string[];
  adaptation_strategy: string;
}
```

### PlanSchema v2

Change `PlanSchema` in `src/llm/output-schemas.ts` to accept the v2 structure:

```ts
export const PlanSchema = z.object({
  episodes: z.array(
    z.object({
      episode_no: z.number().int().min(1),
      title: z.string(),
      opening_hook: z.string(),
      main_goal: z.string(),
      core_conflict: z.string(),
      turning_point: z.string(),
      cliffhanger: z.string(),
      estimated_duration_seconds: z.number().int().min(1),
      event_ids: z.array(z.string()).default([]),
      source_refs: z.array(z.string()).default([]),
    }),
  ),
  scene_plan: z.array(
    z.object({
      episode_no: z.number().int().min(1),
      scene_no: z.number().int().min(1),
      location_id: z.string(),
      purpose: z.string(),
      conflict: z.string(),
      emotional_shift: z.string(),
      required_character_ids: z.array(z.string()).default([]),
      event_ids: z.array(z.string()).default([]),
      source_refs: z.array(z.string()).default([]),
      summary: z.string(),
    }),
  ),
  coverage: z.object({
    covered_event_ids: z.array(z.string()).default([]),
    omitted_event_ids: z.array(z.string()).default([]),
    coverage_ratio: z.number().min(0).max(1),
  }).optional(),
  pacing_notes: z.array(z.string()),
  adaptation_strategy: z.string(),
});
```

`coverage` is optional in raw plan output because `LiveLLMProvider` will recompute it deterministically.

---

## Task 1: Update Provider Types

**Files:**
- Modify: `src/llm/provider.ts`
- Test: `npm run typecheck`

- [ ] **Step 1: Replace loose analysis/plan interfaces with v2 interfaces**

Update `src/llm/provider.ts` with the data model from the previous section. Preserve existing exported names:

- `AnalyzeResult`
- `PlanScenesResult`
- `ScenePlanEntry`
- `AnalyzeInput`
- `PlanInput`
- `GenerateInput`
- `ScriptProvider`

Keeping those names reduces route and provider churn.

- [ ] **Step 2: Run typecheck and record expected failures**

Run:

```bash
npm run typecheck
```

Expected: FAIL. The existing fixtures, UI types, tests, and live-provider code still assume `key_events: string[]`, `conflicts: string[]`, and old `scene_refs`.

- [ ] **Step 3: Commit after this task passes later**

Do not commit immediately after the failing typecheck. Commit after Task 4 has updated schemas, provider normalization, and fixtures enough for typecheck to pass:

```bash
git add src/llm/provider.ts src/llm/output-schemas.ts src/llm/live-provider.ts src/llm/prompts.ts fixtures/demo-analysis.json fixtures/demo-plan.json
git commit -m "feat(llm): enrich analysis and planning models"
```

---

## Task 2: Upgrade Output Schemas

**Files:**
- Modify: `src/llm/output-schemas.ts`
- Modify: `tests/core/llm-output-schemas.test.ts`

- [ ] **Step 1: Write failing schema tests**

Replace the test file with:

```ts
import { describe, it, expect } from "vitest";
import { RawAnalyzeSchema, PlanSchema } from "../../src/llm/output-schemas";

describe("RawAnalyzeSchema", () => {
  it("accepts structured dramaturgy cards without system IDs", () => {
    const r = RawAnalyzeSchema.safeParse({
      characters: [{ name: "林深", role: "protagonist", source_refs: ["ch1_p1_a"] }],
      locations: [{ name: "旧码头", source_refs: ["ch1_p1_a"] }],
      chapter_summaries: [{ chapter_id: "ch1", summary: "归港" }],
      key_events: [{
        id: "evt_1",
        summary: "林深归港",
        involved_character_names: ["林深"],
        location_name: "旧码头",
        dramatic_function: "hook",
        source_refs: ["ch1_p1_a"],
      }],
      conflicts: [{
        id: "conf_1",
        parties: ["林深", "周砚"],
        surface_conflict: "追查与阻挠",
        underlying_tension: "旧案真相会动摇雾港",
        stakes: "公开真相可能毁掉雾港",
        escalation: "从怀表线索升级到仓库对峙",
        source_refs: ["ch1_p1_a"],
      }],
      relationship_edges: [{
        from_character_name: "林深",
        to_character_name: "周砚",
        relation: "追查者与阻挠者",
        tension: "真相与遮掩",
        source_refs: ["ch1_p1_a"],
      }],
      hook_candidates: [{
        id: "hook_1",
        description: "死里逃生的人回到旧码头",
        why_it_hooks: "开场即抛出生死谜题",
        suggested_episode_no: 1,
        source_refs: ["ch1_p1_a"],
      }],
      adaptation_warnings: ["原文较短，需要压缩成强冲突场景。"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an event with an unsupported dramatic function", () => {
    const r = RawAnalyzeSchema.safeParse({
      characters: [],
      locations: [],
      chapter_summaries: [],
      key_events: [{
        id: "evt_1",
        summary: "x",
        involved_character_names: [],
        location_name: null,
        dramatic_function: "montage",
        source_refs: [],
      }],
      conflicts: [],
    });
    expect(r.success).toBe(false);
  });
});

describe("PlanSchema", () => {
  it("accepts a v2 plan with episode goals and scene purposes", () => {
    const r = PlanSchema.safeParse({
      episodes: [{
        episode_no: 1,
        title: "归来",
        opening_hook: "他回来了",
        main_goal: "林深确认苏晚掌握线索",
        core_conflict: "追查与隐瞒",
        turning_point: "灯塔熄灭",
        cliffhanger: "怀表停在沉船时刻",
        estimated_duration_seconds: 120,
        event_ids: ["evt_1"],
        source_refs: ["ch1_p1_a"],
      }],
      scene_plan: [{
        episode_no: 1,
        scene_no: 1,
        location_id: "loc_dock",
        purpose: "建立归港钩子",
        conflict: "林深想查，苏晚先试探",
        emotional_shift: "压抑 -> 警觉",
        required_character_ids: ["char_lin"],
        event_ids: ["evt_1"],
        source_refs: ["ch1_p1_a"],
        summary: "林深回到旧码头。",
      }],
      coverage: {
        covered_event_ids: ["evt_1"],
        omitted_event_ids: [],
        coverage_ratio: 1,
      },
      pacing_notes: [],
      adaptation_strategy: "balanced",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a scene without a purpose", () => {
    const r = PlanSchema.safeParse({
      episodes: [],
      scene_plan: [{
        episode_no: 1,
        scene_no: 1,
        location_id: "loc_dock",
        conflict: "x",
        emotional_shift: "x",
        required_character_ids: [],
        event_ids: [],
        source_refs: [],
        summary: "x",
      }],
      pacing_notes: [],
      adaptation_strategy: "x",
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run schema tests and verify they fail**

Run:

```bash
npm test -- tests/core/llm-output-schemas.test.ts
```

Expected: FAIL because `RawAnalyzeSchema` and `PlanSchema` still use the v1 shapes.

- [ ] **Step 3: Implement v2 schemas**

Update `src/llm/output-schemas.ts` using the schema code from the Data Model section.

- [ ] **Step 4: Run schema tests and verify they pass**

Run:

```bash
npm test -- tests/core/llm-output-schemas.test.ts
```

Expected: PASS.

---

## Task 3: Add Plan Consistency Helpers

**Files:**
- Create: `src/llm/plan-consistency.ts`
- Create: `tests/core/plan-consistency.test.ts`

- [ ] **Step 1: Write failing consistency tests**

Create `tests/core/plan-consistency.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizePlanCoverage, findPlanConsistencyErrors } from "../../src/llm/plan-consistency";
import type { AnalyzeResult, PlanScenesResult, SourceContext } from "../../src/llm/provider";

const source: SourceContext = {
  source_fingerprint: "fp",
  source_paragraphs: [
    { id: "ch1_p1_a", chapter_id: "ch1", paragraph_index: 1, text: "a", text_preview: "a", hash: "a" },
    { id: "ch1_p2_b", chapter_id: "ch1", paragraph_index: 2, text: "b", text_preview: "b", hash: "b" },
  ],
};

const analysis: AnalyzeResult = {
  characters: [{ id: "char_lin", name: "林深", aliases: [], role: "protagonist", motivation: "", relationship_notes: "", source_refs: ["ch1_p1_a"] }],
  locations: [{ id: "loc_dock", name: "旧码头", description: "", source_refs: ["ch1_p1_a"] }],
  entity_catalog: [{ id: "char_lin", name: "林深" }, { id: "loc_dock", name: "旧码头" }],
  chapter_summaries: [{ chapter_id: "ch1", summary: "归港" }],
  key_events: [
    { id: "evt_1", summary: "归港", involved_character_ids: ["char_lin"], location_id: "loc_dock", dramatic_function: "hook", source_refs: ["ch1_p1_a"] },
    { id: "evt_2", summary: "怀表", involved_character_ids: ["char_lin"], location_id: "loc_dock", dramatic_function: "setup", source_refs: ["ch1_p2_b"] },
  ],
  conflicts: [],
  relationship_edges: [],
  hook_candidates: [],
  adaptation_warnings: [],
};

const plan: PlanScenesResult = {
  episodes: [{
    episode_no: 1,
    title: "归来",
    opening_hook: "他回来了",
    main_goal: "找到线索",
    core_conflict: "追查",
    turning_point: "灯灭",
    cliffhanger: "怀表出现",
    estimated_duration_seconds: 120,
    event_ids: ["evt_1"],
    source_refs: ["ch1_p1_a"],
  }],
  scene_plan: [{
    episode_no: 1,
    scene_no: 1,
    location_id: "loc_dock",
    purpose: "建立钩子",
    conflict: "想查与被试探",
    emotional_shift: "压抑 -> 警觉",
    required_character_ids: ["char_lin"],
    event_ids: ["evt_1"],
    source_refs: ["ch1_p1_a"],
    summary: "林深归港。",
  }],
  coverage: { covered_event_ids: [], omitted_event_ids: [], coverage_ratio: 0 },
  pacing_notes: [],
  adaptation_strategy: "balanced",
};

describe("normalizePlanCoverage", () => {
  it("recomputes coverage from episode and scene event_ids", () => {
    expect(normalizePlanCoverage(plan, analysis)).toEqual({
      covered_event_ids: ["evt_1"],
      omitted_event_ids: ["evt_2"],
      coverage_ratio: 0.5,
    });
  });
});

describe("findPlanConsistencyErrors", () => {
  it("accepts a plan that uses known event, character, location, and source IDs", () => {
    expect(findPlanConsistencyErrors(plan, analysis, source)).toEqual([]);
  });

  it("reports invalid IDs with useful paths", () => {
    const broken: PlanScenesResult = {
      ...plan,
      scene_plan: [{
        ...plan.scene_plan[0]!,
        location_id: "loc_missing",
        required_character_ids: ["char_missing"],
        event_ids: ["evt_missing"],
        source_refs: ["ch9_bad"],
      }],
    };
    expect(findPlanConsistencyErrors(broken, analysis, source)).toEqual([
      "scene_plan[0].location_id invalid: loc_missing",
      "scene_plan[0].required_character_ids[0] invalid: char_missing",
      "scene_plan[0].event_ids[0] invalid: evt_missing",
      "scene_plan[0].source_refs[0] invalid: ch9_bad",
    ]);
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
npm test -- tests/core/plan-consistency.test.ts
```

Expected: FAIL because `src/llm/plan-consistency.ts` does not exist.

- [ ] **Step 3: Implement consistency helpers**

Create `src/llm/plan-consistency.ts`:

```ts
import type { AnalyzeResult, PlanCoverage, PlanScenesResult, SourceContext } from "./provider";

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function normalizePlanCoverage(plan: PlanScenesResult, analysis: AnalyzeResult): PlanCoverage {
  const allEventIds = analysis.key_events.map((event) => event.id);
  const used = uniqueSorted([
    ...plan.episodes.flatMap((episode) => episode.event_ids),
    ...plan.scene_plan.flatMap((scene) => scene.event_ids),
  ].filter((id) => allEventIds.includes(id)));
  const omitted = allEventIds.filter((id) => !used.includes(id));
  const ratio = allEventIds.length === 0 ? 1 : used.length / allEventIds.length;
  return {
    covered_event_ids: used,
    omitted_event_ids: omitted,
    coverage_ratio: Number(ratio.toFixed(4)),
  };
}

export function findPlanConsistencyErrors(
  plan: PlanScenesResult,
  analysis: AnalyzeResult,
  source: SourceContext,
): string[] {
  const errors: string[] = [];
  const eventIds = new Set(analysis.key_events.map((event) => event.id));
  const characterIds = new Set(analysis.characters.map((character) => character.id));
  const locationIds = new Set(analysis.locations.map((location) => location.id));
  const paragraphIds = new Set((source.source_paragraphs ?? []).map((paragraph) => paragraph.id));

  const checkRefs = (refs: string[], valid: ReadonlySet<string>, path: string, label: string): void => {
    refs.forEach((ref, index) => {
      if (!valid.has(ref)) errors.push(`${path}[${index}] invalid: ${ref}`);
    });
  };

  plan.episodes.forEach((episode, episodeIndex) => {
    checkRefs(episode.event_ids, eventIds, `episodes[${episodeIndex}].event_ids`, "event_id");
    checkRefs(episode.source_refs, paragraphIds, `episodes[${episodeIndex}].source_refs`, "source_ref");
  });

  plan.scene_plan.forEach((scene, sceneIndex) => {
    if (!locationIds.has(scene.location_id)) {
      errors.push(`scene_plan[${sceneIndex}].location_id invalid: ${scene.location_id}`);
    }
    checkRefs(scene.required_character_ids, characterIds, `scene_plan[${sceneIndex}].required_character_ids`, "character_id");
    checkRefs(scene.event_ids, eventIds, `scene_plan[${sceneIndex}].event_ids`, "event_id");
    checkRefs(scene.source_refs, paragraphIds, `scene_plan[${sceneIndex}].source_refs`, "source_ref");
  });

  return errors;
}
```

- [ ] **Step 4: Run the new test and verify it passes**

Run:

```bash
npm test -- tests/core/plan-consistency.test.ts
```

Expected: PASS.

---

## Task 4: Normalize Live Analyze Results

**Files:**
- Modify: `src/llm/live-provider.ts`
- Modify: `tests/core/live-provider.test.ts`

- [ ] **Step 1: Update live analyze test to expect v2 cards**

In `tests/core/live-provider.test.ts`, update the first analyze test LLM JSON:

```ts
const json = JSON.stringify({
  characters: [{ name: "林深", role: "protagonist", source_refs: ["ch1_p1_aaaa1111", "ch9_bad"] }],
  locations: [{ name: "旧码头", source_refs: ["ch1_p1_aaaa1111"] }],
  chapter_summaries: [{ chapter_id: "ch1", summary: "归港" }],
  key_events: [{
    id: "evt_return",
    summary: "林深回到旧码头",
    involved_character_names: ["林深"],
    location_name: "旧码头",
    dramatic_function: "hook",
    source_refs: ["ch1_p1_aaaa1111", "bad_ref"],
  }],
  conflicts: [{
    id: "conf_truth",
    parties: ["林深"],
    surface_conflict: "追查真相",
    underlying_tension: "真相被遮掩",
    stakes: "旧案会牵动雾港",
    escalation: "线索指向仓库",
    source_refs: ["ch1_p1_aaaa1111"],
  }],
  relationship_edges: [],
  hook_candidates: [{
    id: "hook_return",
    description: "死里逃生的人归港",
    why_it_hooks: "开场抛出生死谜题",
    suggested_episode_no: 1,
    source_refs: ["ch1_p1_aaaa1111"],
  }],
  adaptation_warnings: ["原文较短，需要强化冲突。"],
});
```

Then add expectations:

```ts
expect(r.key_events[0]!.involved_character_ids).toEqual([r.characters[0]!.id]);
expect(r.key_events[0]!.location_id).toBe(r.locations[0]!.id);
expect(r.key_events[0]!.source_refs).toEqual(["ch1_p1_aaaa1111"]);
expect(r.hook_candidates[0]!.source_refs).toEqual(["ch1_p1_aaaa1111"]);
expect(r.adaptation_warnings).toEqual(["原文较短，需要强化冲突。"]);
```

- [ ] **Step 2: Run live-provider tests and verify they fail**

Run:

```bash
npm test -- tests/core/live-provider.test.ts
```

Expected: FAIL because `LiveLLMProvider.analyze` still maps only string `key_events` and `conflicts`.

- [ ] **Step 3: Add local mapping helpers in `live-provider.ts`**

Add these helpers near the existing `asStrArr` functions:

```ts
function validRefs(refs: unknown, validIds: ReadonlySet<string>): string[] {
  return asStrArr(refs).filter((ref) => validIds.has(ref));
}

function eventId(id: string, index: number): string {
  const safe = id.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return safe || `evt_${index + 1}`;
}
```

Inside `analyze`, after `chars` and `locs` are created, add:

```ts
const rawEvents = Array.isArray(raw.key_events) ? raw.key_events : [];
const rawConflicts = Array.isArray(raw.conflicts) ? raw.conflicts : [];
const rawRelationships = Array.isArray(raw.relationship_edges) ? raw.relationship_edges : [];
const rawHooks = Array.isArray(raw.hook_candidates) ? raw.hook_candidates : [];
```

Map event cards:

```ts
const key_events: AnalyzeResult["key_events"] = rawEvents.map((event, index) => {
  const e = event as Record<string, unknown>;
  const locationName = asStr(e.location_name);
  return {
    id: eventId(asStr(e.id), index),
    summary: asStr(e.summary),
    involved_character_ids: asStrArr(e.involved_character_names)
      .map((name) => chars.nameToId[canonicalizeName(name)])
      .filter((id): id is string => Boolean(id)),
    location_id: locationName ? (locs.nameToId[canonicalizeName(locationName)] ?? null) : null,
    dramatic_function: e.dramatic_function === "setup" || e.dramatic_function === "conflict" || e.dramatic_function === "reversal" || e.dramatic_function === "climax" || e.dramatic_function === "resolution"
      ? e.dramatic_function
      : "hook",
    source_refs: validRefs(e.source_refs, validIds),
  };
});
```

Also import `canonicalizeName`:

```ts
import { canonicalizeName } from "../core/entities/entity-id";
```

Map conflicts:

```ts
const conflicts: AnalyzeResult["conflicts"] = rawConflicts.map((conflict, index) => {
  const c = conflict as Record<string, unknown>;
  return {
    id: eventId(asStr(c.id), index).replace(/^evt_/, "conf_"),
    parties: asStrArr(c.parties),
    surface_conflict: asStr(c.surface_conflict),
    underlying_tension: asStr(c.underlying_tension),
    stakes: asStr(c.stakes),
    escalation: asStr(c.escalation),
    source_refs: validRefs(c.source_refs, validIds),
  };
});
```

Map relationships:

```ts
const relationship_edges: AnalyzeResult["relationship_edges"] = rawRelationships
  .map((edge) => {
    const e = edge as Record<string, unknown>;
    const from = chars.nameToId[canonicalizeName(asStr(e.from_character_name))];
    const to = chars.nameToId[canonicalizeName(asStr(e.to_character_name))];
    if (!from || !to) return null;
    return {
      from_character_id: from,
      to_character_id: to,
      relation: asStr(e.relation),
      tension: asStr(e.tension),
      source_refs: validRefs(e.source_refs, validIds),
    };
  })
  .filter((edge): edge is AnalyzeResult["relationship_edges"][number] => edge !== null);
```

Map hooks:

```ts
const hook_candidates: AnalyzeResult["hook_candidates"] = rawHooks.map((hook, index) => {
  const h = hook as Record<string, unknown>;
  const suggested = Number(h.suggested_episode_no);
  return {
    id: eventId(asStr(h.id), index).replace(/^evt_/, "hook_"),
    description: asStr(h.description),
    why_it_hooks: asStr(h.why_it_hooks),
    suggested_episode_no: Number.isInteger(suggested) && suggested > 0 ? suggested : 1,
    source_refs: validRefs(h.source_refs, validIds),
  };
});
```

Return these values:

```ts
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
```

- [ ] **Step 4: Run live-provider tests**

Run:

```bash
npm test -- tests/core/live-provider.test.ts
```

Expected: The analyze tests pass. Other tests in the file still fail until Task 5 updates the plan shape.

---

## Task 5: Upgrade Plan Prompt, Validation, and Retry

**Files:**
- Modify: `src/llm/prompts.ts`
- Modify: `src/llm/live-provider.ts`
- Modify: `tests/core/llm-prompts.test.ts`
- Modify: `tests/core/live-provider.test.ts`

- [ ] **Step 1: Update prompt tests to expect v2 content**

In `tests/core/llm-prompts.test.ts`, update the `analysis` fixture to include v2 arrays:

```ts
key_events: [{
  id: "evt_return",
  summary: "林深回到旧码头",
  involved_character_ids: ["char_lin"],
  location_id: "loc_dock",
  dramatic_function: "hook",
  source_refs: ["ch1_p1_aaaa1111"],
}],
conflicts: [{
  id: "conf_truth",
  parties: ["林深"],
  surface_conflict: "追查真相",
  underlying_tension: "旧案被隐瞒",
  stakes: "真相会改变雾港",
  escalation: "线索指向仓库",
  source_refs: ["ch1_p1_aaaa1111"],
}],
relationship_edges: [],
hook_candidates: [{
  id: "hook_return",
  description: "死里逃生的人回到码头",
  why_it_hooks: "开场抛出生死谜题",
  suggested_episode_no: 1,
  source_refs: ["ch1_p1_aaaa1111"],
}],
adaptation_warnings: [],
```

Update the `plan` fixture to use v2 fields:

```ts
const plan: PlanScenesResult = {
  episodes: [{
    episode_no: 1,
    title: "归来",
    opening_hook: "h",
    main_goal: "林深确认线索",
    core_conflict: "c",
    turning_point: "灯塔熄灭",
    cliffhanger: "cl",
    estimated_duration_seconds: 120,
    event_ids: ["evt_return"],
    source_refs: ["ch1_p1_aaaa1111"],
  }],
  scene_plan: [{
    episode_no: 1,
    scene_no: 1,
    location_id: "loc_dock",
    purpose: "建立钩子",
    conflict: "试探",
    emotional_shift: "压抑 -> 警觉",
    required_character_ids: ["char_lin"],
    event_ids: ["evt_return"],
    source_refs: ["ch1_p1_aaaa1111"],
    summary: "s",
  }],
  coverage: { covered_event_ids: ["evt_return"], omitted_event_ids: [], coverage_ratio: 1 },
  pacing_notes: [],
  adaptation_strategy: "balanced",
};
```

Add prompt expectations:

```ts
expect(joined).toContain("evt_return");
expect(joined).toContain("hook_candidates");
expect(joined).toContain("purpose");
expect(joined).toContain("emotional_shift");
```

- [ ] **Step 2: Update live plan test to v2**

In `tests/core/live-provider.test.ts`, update the `LiveLLMProvider.planScenes` test JSON:

```ts
const planJson = JSON.stringify({
  episodes: [{
    episode_no: 1,
    title: "归来",
    opening_hook: "h",
    main_goal: "林深确认线索",
    core_conflict: "c",
    turning_point: "灯塔熄灭",
    cliffhanger: "cl",
    estimated_duration_seconds: 120,
    event_ids: ["evt_return"],
    source_refs: ["ch1_p1_aaaa1111"],
  }],
  scene_plan: [{
    episode_no: 1,
    scene_no: 1,
    location_id: "loc_dock",
    purpose: "建立钩子",
    conflict: "试探",
    emotional_shift: "压抑 -> 警觉",
    required_character_ids: ["char_lin"],
    event_ids: ["evt_return"],
    source_refs: ["ch1_p1_aaaa1111"],
    summary: "s",
  }],
  pacing_notes: [],
  adaptation_strategy: "balanced",
});
```

Use an analysis object with one event, one character, and one location:

```ts
const analysis: AnalyzeResult = {
  characters: [{ id: "char_lin", name: "林深", aliases: [], role: "protagonist", motivation: "", relationship_notes: "", source_refs: ["ch1_p1_aaaa1111"] }],
  locations: [{ id: "loc_dock", name: "旧码头", description: "", source_refs: ["ch1_p1_aaaa1111"] }],
  entity_catalog: [{ id: "char_lin", name: "林深" }, { id: "loc_dock", name: "旧码头" }],
  chapter_summaries: [{ chapter_id: "ch1", summary: "归港" }],
  key_events: [{ id: "evt_return", summary: "归港", involved_character_ids: ["char_lin"], location_id: "loc_dock", dramatic_function: "hook", source_refs: ["ch1_p1_aaaa1111"] }],
  conflicts: [],
  relationship_edges: [],
  hook_candidates: [],
  adaptation_warnings: [],
};
```

Add:

```ts
expect(r.coverage.coverage_ratio).toBe(1);
expect(r.scene_plan[0]!.purpose).toBe("建立钩子");
```

- [ ] **Step 3: Run prompt and live tests and verify they fail**

Run:

```bash
npm test -- tests/core/llm-prompts.test.ts tests/core/live-provider.test.ts
```

Expected: FAIL until prompts and `planScenes` are updated.

- [ ] **Step 4: Update `buildPlanMessages` prompt**

In `src/llm/prompts.ts`, add helpers:

```ts
function eventCatalog(analysis: AnalyzeResult): string {
  return analysis.key_events.map((event) => `${event.id}: ${event.summary} (${event.dramatic_function}) refs=${event.source_refs.join(",")}`).join("\n");
}

function conflictCatalog(analysis: AnalyzeResult): string {
  return analysis.conflicts.map((conflict) => `${conflict.id}: ${conflict.surface_conflict}; stakes=${conflict.stakes}; escalation=${conflict.escalation}`).join("\n");
}
```

Update `buildPlanMessages` user content to include:

```ts
关键事件：
${eventCatalog(analysis)}

冲突卡：
${conflictCatalog(analysis)}

hook_candidates（开场钩子候选）：
${JSON.stringify(analysis.hook_candidates)}
```

Update the requested output JSON example to the v2 shape:

```json
{"episodes":[{"episode_no":1,"title":"","opening_hook":"","main_goal":"","core_conflict":"","turning_point":"","cliffhanger":"","estimated_duration_seconds":120,"event_ids":[],"source_refs":[]}],"scene_plan":[{"episode_no":1,"scene_no":1,"location_id":"","purpose":"","conflict":"","emotional_shift":"","required_character_ids":[],"event_ids":[],"source_refs":[],"summary":""}],"pacing_notes":[],"adaptation_strategy":""}
```

- [ ] **Step 5: Update `buildGenerateMessages` prompt to consume v2 plan**

In `buildGenerateMessages`, add text explaining the plan fields:

```ts
分集规划包含 main_goal / turning_point / event_ids / source_refs。生成剧本时必须服务这些规划目标。
分场规划包含 purpose / conflict / emotional_shift / required_character_ids / event_ids / source_refs。每个生成场景应对应一条 scene_plan。
```

Keep the model output for generate unchanged: it still returns only `episodes` and `adaptation_notes`.

- [ ] **Step 6: Add consistency retry in `LiveLLMProvider.planScenes`**

Import helpers:

```ts
import { findPlanConsistencyErrors, normalizePlanCoverage } from "./plan-consistency";
```

Replace `planScenes` with a retry loop similar to `generateScript`:

```ts
async planScenes(input: PlanInput): Promise<PlanScenesResult> {
  if (!input.analysis) throw new Error("live planScenes 需要 analyze 结果。");
  const messages: ChatMessage[] = [...buildPlanMessages(input, input.analysis)];
  let lastError = "";
  for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
    const raw = await this.complete(messages);
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch (e) {
      lastError = `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`;
      messages.push({ role: "assistant", content: raw }, { role: "user", content: `${lastError}。只返回合法 JSON。` });
      continue;
    }
    const result = PlanSchema.safeParse(parsed);
    if (!result.success) {
      lastError = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      messages.push({ role: "assistant", content: raw }, { role: "user", content: `分集/分场规划结构不合法：${lastError}。请修正后只返回合法 JSON。` });
      continue;
    }
    const plan: PlanScenesResult = {
      ...result.data,
      coverage: normalizePlanCoverage(result.data as PlanScenesResult, input.analysis),
    } as PlanScenesResult;
    const consistencyErrors = findPlanConsistencyErrors(plan, input.analysis, input);
    if (consistencyErrors.length === 0) return plan;
    lastError = consistencyErrors.join("; ");
    messages.push({ role: "assistant", content: raw }, { role: "user", content: `规划引用了不存在的 ID：${lastError}。只能使用给定 event_ids、character_ids、location_ids 和 source_refs。` });
  }
  throw new Error(`live 分场规划在 ${this.maxRetries + 1} 次尝试后仍不合法：${lastError}`);
}
```

- [ ] **Step 7: Run prompt and live tests**

Run:

```bash
npm test -- tests/core/llm-prompts.test.ts tests/core/live-provider.test.ts tests/core/plan-consistency.test.ts
```

Expected: PASS.

---

## Task 6: Upgrade Demo Fixtures

**Files:**
- Modify: `fixtures/demo-analysis.json`
- Modify: `fixtures/demo-plan.json`
- Modify: `tests/integration/fixture-pipeline.test.ts`

- [ ] **Step 1: Replace `fixtures/demo-analysis.json` with structured v2 data**

Use the same existing characters, locations, entity catalog, and chapter summaries. Replace `key_events` and `conflicts`, and add relationship/hook/warnings:

```json
{
  "key_events": [
    {
      "id": "evt_return_to_port",
      "summary": "林深归港并被沉船记忆击中",
      "involved_character_ids": ["char_aadd69"],
      "location_id": "loc_a31088",
      "dramatic_function": "hook",
      "source_refs": ["ch1_p1_df6f5806"]
    },
    {
      "id": "evt_su_wan_waits",
      "summary": "苏晚在灯塔锈门后出现，没有问林深为何还活着",
      "involved_character_ids": ["char_aadd69", "char_d65c66"],
      "location_id": "loc_3bbdc4",
      "dramatic_function": "setup",
      "source_refs": ["ch1_p2_cfaa58f1"]
    },
    {
      "id": "evt_watch_coordinates",
      "summary": "苏晚交出刻有坐标的旧怀表",
      "involved_character_ids": ["char_aadd69", "char_d65c66"],
      "location_id": "loc_3bbdc4",
      "dramatic_function": "setup",
      "source_refs": ["ch2_p1_acbae21c"]
    },
    {
      "id": "evt_zhou_blocks_warehouse",
      "summary": "周砚封锁仓库并警告二人不要追查货单",
      "involved_character_ids": ["char_aadd69", "char_d65c66", "char_005a7b"],
      "location_id": "loc_3cb28f",
      "dramatic_function": "conflict",
      "source_refs": ["ch2_p2_87f95f45"]
    },
    {
      "id": "evt_letter_in_hidden_compartment",
      "summary": "林深在仓库暗格里找到父亲写给苏晚的信",
      "involved_character_ids": ["char_aadd69", "char_d65c66"],
      "location_id": "loc_3cb28f",
      "dramatic_function": "reversal",
      "source_refs": ["ch3_p1_cbe21379"]
    },
    {
      "id": "evt_truth_choice",
      "summary": "林深意识到真相既会毁掉雾港，也会救回被控制的船员家属",
      "involved_character_ids": ["char_aadd69", "char_005a7b"],
      "location_id": "loc_a31088",
      "dramatic_function": "climax",
      "source_refs": ["ch3_p2_3d978716"]
    }
  ],
  "conflicts": [
    {
      "id": "conf_truth_vs_coverup",
      "parties": ["林深", "周砚"],
      "surface_conflict": "林深追查父亲沉船真相，周砚封锁仓库和货单",
      "underlying_tension": "雾港表面的安稳建立在旧案被掩盖之上",
      "stakes": "公开真相会摧毁周砚的控制，也可能让整个雾港付出代价",
      "escalation": "从归港疑问升级到怀表坐标、仓库封锁和信件证据",
      "source_refs": ["ch1_p1_df6f5806", "ch2_p2_87f95f45", "ch3_p2_3d978716"]
    },
    {
      "id": "conf_truth_vs_home",
      "parties": ["林深", "雾港"],
      "surface_conflict": "林深必须决定是否公开会毁掉雾港的真相",
      "underlying_tension": "正义与保护故土之间互相撕扯",
      "stakes": "船员家属能否获救，雾港能否承受真相",
      "escalation": "父亲的信把个人复仇推成公共选择",
      "source_refs": ["ch3_p1_cbe21379", "ch3_p2_3d978716"]
    }
  ],
  "relationship_edges": [
    {
      "from_character_id": "char_aadd69",
      "to_character_id": "char_d65c66",
      "relation": "旧识与线索托付者",
      "tension": "苏晚知道更多真相，却不直接说破",
      "source_refs": ["ch1_p2_cfaa58f1", "ch2_p1_acbae21c"]
    },
    {
      "from_character_id": "char_aadd69",
      "to_character_id": "char_005a7b",
      "relation": "追查者与阻挠者",
      "tension": "林深越接近货单，周砚越强硬封锁",
      "source_refs": ["ch2_p2_87f95f45", "ch3_p2_3d978716"]
    }
  ],
  "hook_candidates": [
    {
      "id": "hook_not_supposed_alive",
      "description": "苏晚没有问林深为什么还活着，暗示三年前沉船另有隐情",
      "why_it_hooks": "一句反常反应同时抛出生死谜题和旧关系悬念",
      "suggested_episode_no": 1,
      "source_refs": ["ch1_p2_cfaa58f1"]
    },
    {
      "id": "hook_watch_coordinates",
      "description": "旧怀表内侧刻着父亲失踪前留下的坐标",
      "why_it_hooks": "道具明确、目标清晰，适合推动第二集开场",
      "suggested_episode_no": 2,
      "source_refs": ["ch2_p1_acbae21c"]
    }
  ],
  "adaptation_warnings": [
    "Demo 原文只有 6 个段落，短剧化时需要用动作和对白补足场面张力。",
    "周砚只在后两章出现，规划时应提前让他的威胁感进入第二集。"
  ]
}
```

Merge this snippet into the existing JSON instead of deleting existing entity fields.

- [ ] **Step 2: Replace `fixtures/demo-plan.json` with v2 fields**

Use this v2 plan:

```json
{
  "episodes": [
    {
      "episode_no": 1,
      "title": "归港灯灭",
      "opening_hook": "三年后，林深踏上旧码头，海风把他父亲沉船那夜的味道吹了回来。",
      "main_goal": "让林深重新进入雾港旧案，并确认苏晚掌握关键线索。",
      "core_conflict": "林深想知道苏晚为何等他，苏晚却先抛出他不该活着的谜。",
      "turning_point": "苏晚的反常沉默让林深意识到沉船不是意外。",
      "cliffhanger": "灯塔在两人对视时骤然熄灭。",
      "estimated_duration_seconds": 120,
      "event_ids": ["evt_return_to_port", "evt_su_wan_waits"],
      "source_refs": ["ch1_p1_df6f5806", "ch1_p2_cfaa58f1"]
    },
    {
      "episode_no": 2,
      "title": "怀表坐标",
      "opening_hook": "苏晚打开怀表，坐标指向周砚封死的仓库。",
      "main_goal": "让林深和苏晚从线索进入明确调查目标。",
      "core_conflict": "林深和苏晚要查货单，周砚出面封路。",
      "turning_point": "周砚的强硬封锁证明仓库里有不能见光的证据。",
      "cliffhanger": "仓库门缝里传出怀表一样的滴答声。",
      "estimated_duration_seconds": 120,
      "event_ids": ["evt_watch_coordinates", "evt_zhou_blocks_warehouse"],
      "source_refs": ["ch2_p1_acbae21c", "ch2_p2_87f95f45"]
    },
    {
      "episode_no": 3,
      "title": "真相上岸",
      "opening_hook": "暴雨夜，林深在仓库暗格里摸到父亲亲笔信。",
      "main_goal": "让林深完成从追查父亲到承担公共真相的转变。",
      "core_conflict": "林深必须决定是否公开会毁掉雾港的真相。",
      "turning_point": "父亲的信揭开真相也揭开船员家属被控制的现实。",
      "cliffhanger": "周砚带人围住旧码头，逼林深交出那封信。",
      "estimated_duration_seconds": 120,
      "event_ids": ["evt_letter_in_hidden_compartment", "evt_truth_choice"],
      "source_refs": ["ch3_p1_cbe21379", "ch3_p2_3d978716"]
    }
  ],
  "scene_plan": [
    {
      "episode_no": 1,
      "scene_no": 1,
      "location_id": "loc_a31088",
      "purpose": "用归港画面建立主角创伤和三年前沉船悬念。",
      "conflict": "林深想压住回忆，码头环境不断把他推回沉船那夜。",
      "emotional_shift": "克制 -> 被旧案刺痛",
      "required_character_ids": ["char_aadd69"],
      "event_ids": ["evt_return_to_port"],
      "source_refs": ["ch1_p1_df6f5806"],
      "summary": "林深独自归港，沉船记忆压回胸口。"
    },
    {
      "episode_no": 1,
      "scene_no": 2,
      "location_id": "loc_3bbdc4",
      "purpose": "让苏晚出场并抛出林深为何活着的反常谜题。",
      "conflict": "林深想得到解释，苏晚用沉默和试探掌控谈话。",
      "emotional_shift": "警觉 -> 不安",
      "required_character_ids": ["char_aadd69", "char_d65c66"],
      "event_ids": ["evt_su_wan_waits"],
      "source_refs": ["ch1_p2_cfaa58f1"],
      "summary": "苏晚在灯塔门口出现，暗示林深本不该活着。"
    },
    {
      "episode_no": 2,
      "scene_no": 1,
      "location_id": "loc_3bbdc4",
      "purpose": "用怀表坐标把悬念转成明确调查目标。",
      "conflict": "苏晚逼林深继续查，林深担心线索把他拖回父亲旧案。",
      "emotional_shift": "怀疑 -> 决定行动",
      "required_character_ids": ["char_aadd69", "char_d65c66"],
      "event_ids": ["evt_watch_coordinates"],
      "source_refs": ["ch2_p1_acbae21c"],
      "summary": "苏晚交出怀表坐标，指向父亲失踪前的路线。"
    },
    {
      "episode_no": 2,
      "scene_no": 2,
      "location_id": "loc_3cb28f",
      "purpose": "让周砚成为明确对抗面，并证明仓库里有证据。",
      "conflict": "林深和苏晚想进仓库，周砚用人和警告封死入口。",
      "emotional_shift": "主动 -> 被压迫",
      "required_character_ids": ["char_aadd69", "char_d65c66", "char_005a7b"],
      "event_ids": ["evt_zhou_blocks_warehouse"],
      "source_refs": ["ch2_p2_87f95f45"],
      "summary": "周砚封住仓库，阻止林深追查货单。"
    },
    {
      "episode_no": 3,
      "scene_no": 1,
      "location_id": "loc_3cb28f",
      "purpose": "揭示父亲信件，把外部调查变成道德选择。",
      "conflict": "林深想拿到证据，信件内容却让真相代价变得更沉重。",
      "emotional_shift": "急切 -> 震动",
      "required_character_ids": ["char_aadd69", "char_d65c66"],
      "event_ids": ["evt_letter_in_hidden_compartment"],
      "source_refs": ["ch3_p1_cbe21379"],
      "summary": "林深找到父亲写给苏晚的信，真相显形。"
    },
    {
      "episode_no": 3,
      "scene_no": 2,
      "location_id": "loc_a31088",
      "purpose": "完成主角选择，并把真相公开的代价推到台前。",
      "conflict": "林深要让真相上岸，周砚要继续用雾港安稳压住他。",
      "emotional_shift": "犹豫 -> 决断",
      "required_character_ids": ["char_aadd69", "char_005a7b"],
      "event_ids": ["evt_truth_choice"],
      "source_refs": ["ch3_p2_3d978716"],
      "summary": "林深面对周砚与雾港家属，决定让真相上岸。"
    }
  ],
  "coverage": {
    "covered_event_ids": [
      "evt_return_to_port",
      "evt_su_wan_waits",
      "evt_watch_coordinates",
      "evt_zhou_blocks_warehouse",
      "evt_letter_in_hidden_compartment",
      "evt_truth_choice"
    ],
    "omitted_event_ids": [],
    "coverage_ratio": 1
  },
  "pacing_notes": [
    "每集控制在两场，第一场抛线索，第二场给反转或悬念。",
    "短剧节奏优先保留怀表、货单、暗格信三个可视化线索。",
    "每场都绑定一个关键事件，避免场景只承担气氛而不推动剧情。"
  ],
  "adaptation_strategy": "保留父亲沉船主线，压缩旁支人物，把周砚作为明确对抗面；用怀表、仓库、信件三个道具串起三集悬念。"
}
```

- [ ] **Step 3: Update fixture pipeline test**

In `tests/integration/fixture-pipeline.test.ts`, add:

```ts
expect(analysis.key_events[0]!.id).toBe("evt_return_to_port");
expect(analysis.hook_candidates.length).toBeGreaterThan(0);
expect(plan.coverage.coverage_ratio).toBe(1);
expect(plan.scene_plan[0]!.purpose).toContain("归港");
```

- [ ] **Step 4: Run fixture pipeline test**

Run:

```bash
npm test -- tests/integration/fixture-pipeline.test.ts
```

Expected: PASS.

---

## Task 7: Update UI Intermediate Displays

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Update local UI TypeScript interfaces**

In `src/app/page.tsx`, change `AnalyzeResult` and `PlanScenesResult` interfaces to match v2 fields. Use the same field names as `src/llm/provider.ts`.

Use compact UI-local interfaces:

```ts
interface KeyEventCard {
  id: string;
  summary: string;
  dramatic_function: string;
  source_refs: string[];
}

interface ConflictCard {
  id: string;
  surface_conflict: string;
  stakes: string;
  source_refs: string[];
}

interface HookCandidate {
  id: string;
  description: string;
  why_it_hooks: string;
  source_refs: string[];
}
```

Then update `AnalyzeResult`:

```ts
interface AnalyzeResult {
  characters: Array<{ id: string; name: string; role: string; motivation: string; source_refs: string[] }>;
  locations: Array<{ id: string; name: string; description: string; source_refs: string[] }>;
  key_events: KeyEventCard[];
  conflicts: ConflictCard[];
  hook_candidates: HookCandidate[];
  adaptation_warnings: string[];
}
```

Update plan scene UI type:

```ts
interface PlanScenesResult {
  episodes: Array<{
    episode_no: number;
    title: string;
    opening_hook: string;
    main_goal: string;
    core_conflict: string;
    turning_point: string;
    cliffhanger: string;
    event_ids: string[];
    source_refs: string[];
  }>;
  scene_plan: Array<{
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
  }>;
  coverage: { covered_event_ids: string[]; omitted_event_ids: string[]; coverage_ratio: number };
  pacing_notes: string[];
  adaptation_strategy: string;
}
```

- [ ] **Step 2: Add event/conflict/hook display in the pipeline panel**

In the middle pipeline panel, after the "人物 · 地点" section and before "分场规划", add a section:

```tsx
<div className="section">
  <h2>事件 · 冲突 · 钩子</h2>
  {analysis ? (
    <div className="list">
      {analysis.key_events.map((event) => (
        <div className="row" key={event.id}>
          <div className="row-title"><span>{event.summary}</span><span className="code">{event.id}</span></div>
          <p>{event.dramatic_function} · {event.source_refs.join(", ")}</p>
        </div>
      ))}
      {analysis.conflicts.map((conflict) => (
        <div className="row" key={conflict.id}>
          <div className="row-title"><span>{conflict.surface_conflict}</span><span className="code">{conflict.id}</span></div>
          <p>{conflict.stakes}</p>
        </div>
      ))}
      {analysis.hook_candidates.map((hook) => (
        <div className="row" key={hook.id}>
          <div className="row-title"><span>{hook.description}</span><span className="code">{hook.id}</span></div>
          <p>{hook.why_it_hooks}</p>
        </div>
      ))}
    </div>
  ) : (
    <p className="code">尚无事件/冲突分析</p>
  )}
</div>
```

- [ ] **Step 3: Update scene plan rows**

Replace scene plan row body:

```tsx
<p>{scene.summary}</p>
```

with:

```tsx
<p>{scene.purpose}</p>
<p>{scene.conflict} · {scene.emotional_shift}</p>
```

After the scene list, show coverage:

```tsx
<p className="hint">
  关键事件覆盖率 {Math.round(plan.coverage.coverage_ratio * 100)}%
  （{plan.coverage.covered_event_ids.length}/{plan.coverage.covered_event_ids.length + plan.coverage.omitted_event_ids.length}）
</p>
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS after all provider, fixture, and UI types are aligned.

---

## Task 8: Update Generate Tests and Prompt Consumption

**Files:**
- Modify: `tests/core/live-provider.test.ts`
- Modify: `tests/core/llm-prompts.test.ts`
- Modify: `src/llm/prompts.ts`

- [ ] **Step 1: Ensure generate test uses v2 analysis and plan**

In `tests/core/live-provider.test.ts`, update the `analysis` and `plan` constants inside `LiveLLMProvider.generateScript` describe block to include all v2 fields. Use:

```ts
key_events: [{ id: "evt_return", summary: "归港", involved_character_ids: ["char_lin"], location_id: "loc_dock", dramatic_function: "hook", source_refs: ["ch1_p1_aaaa1111"] }],
conflicts: [{ id: "conf_truth", parties: ["林深"], surface_conflict: "追查真相", underlying_tension: "旧案被隐瞒", stakes: "真相会改变雾港", escalation: "线索指向仓库", source_refs: ["ch1_p1_aaaa1111"] }],
relationship_edges: [],
hook_candidates: [],
adaptation_warnings: [],
```

Use this plan:

```ts
const plan = {
  episodes: [{
    episode_no: 1,
    title: "归来",
    opening_hook: "他回来了",
    main_goal: "确认线索",
    core_conflict: "真相",
    turning_point: "灯灭",
    cliffhanger: "灯灭了",
    estimated_duration_seconds: 120,
    event_ids: ["evt_return"],
    source_refs: ["ch1_p1_aaaa1111"],
  }],
  scene_plan: [{
    episode_no: 1,
    scene_no: 1,
    location_id: "loc_dock",
    purpose: "建立钩子",
    conflict: "真相试探",
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
```

- [ ] **Step 2: Ensure generate prompt mentions plan adherence**

In `tests/core/llm-prompts.test.ts`, update the generate prompt expectation:

```ts
expect(joined).toContain("main_goal");
expect(joined).toContain("scene_plan");
expect(joined).toContain("purpose");
expect(joined).toContain("emotional_shift");
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/core/live-provider.test.ts tests/core/llm-prompts.test.ts
```

Expected: PASS.

---

## Task 9: Full Verification

**Files:**
- No new files.
- Verify all modified files.

- [ ] **Step 1: Run the full unit/integration suite**

Run:

```bash
npm test
```

Expected:

```text
Test Files  25 passed
Tests       all passed
```

The exact number of tests may increase from 124 because this plan adds `tests/core/plan-consistency.test.ts`.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS. If build fails because of Next-generated type files, inspect the error and fix the real source type mismatch rather than editing `.next` files.

- [ ] **Step 4: Manual fixture smoke**

Run:

```bash
npm run dev
```

Open the local URL printed by Next.js. In the UI:

1. Click `载入 Demo`.
2. Click `解析`.
3. Click `分析`.
4. Confirm the middle panel shows event cards, conflict cards, and hook candidates.
5. Click `规划`.
6. Confirm each scene shows purpose/conflict/emotional shift and coverage is 100%.
7. Click `生成`.
8. Confirm YAML is produced and validation passes.

- [ ] **Step 5: Final commit**

Run:

```bash
git status --short
git add src/llm/provider.ts src/llm/output-schemas.ts src/llm/prompts.ts src/llm/live-provider.ts src/llm/plan-consistency.ts src/app/page.tsx fixtures/demo-analysis.json fixtures/demo-plan.json tests/core/llm-output-schemas.test.ts tests/core/llm-prompts.test.ts tests/core/live-provider.test.ts tests/core/plan-consistency.test.ts tests/integration/fixture-pipeline.test.ts
git commit -m "feat(llm): strengthen analysis and planning stages"
```

Do not stage unrelated files such as `next-env.d.ts` unless the implementation actually changes them and the diff is understood.

---

## Acceptance Criteria

- Demo fixture mode still works without API keys.
- Analyze output includes structured key events, conflicts, relationship edges, hook candidates, and adaptation warnings.
- Plan output includes episode goals, turning points, scene purposes, scene conflicts, emotional shifts, event IDs, source refs, and recomputed event coverage.
- Live analyze maps model-provided names to system-owned character/location IDs.
- Live plan retries when it references nonexistent events, characters, locations, or source paragraph IDs.
- Generate stage consumes richer planning context but still outputs the existing screenplay YAML schema.
- UI makes the richer analysis and planning visible to an evaluator.
- `npm test`, `npm run typecheck`, and `npm run build` pass.

## Self-Review Notes

- Spec coverage: The plan covers analysis enrichment, planning enrichment, prompt updates, provider normalization, fixture updates, UI display, tests, and verification.
- Scope check: Storyboard and video prompt generation are intentionally excluded.
- Type consistency: Use `source_refs`, not the old `scene_refs`, in plan episodes. Use `event_ids` everywhere for analysis-to-plan linkage.
- Implementation risk: The highest-risk area is `LiveLLMProvider.planScenes` retry logic. Keep it parallel to `generateScript` and add focused tests before touching UI.
