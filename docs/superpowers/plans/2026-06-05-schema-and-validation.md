# Schema & Structural Validation Layer — Implementation Plan (Plan 2, P0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the screenplay YAML Schema as Zod (containers lenient, beats strict) with inferred TS types and adaptation profiles, plus a structural validator that returns path-precise `SCHEMA_ERROR`s and non-blocking `UNKNOWN_FIELD` warnings.

**Architecture:** Pure TypeScript + Zod, no framework/network — continues the deterministic core from Plan 1. Container objects use `z.looseObject` (keep unknown keys, never silently drop author edits); `beats` are a `z.discriminatedUnion` of `z.strictObject` variants (the one strict exception — a field that doesn't belong to the beat's `type` is a hard error). The validator maps every Zod issue to one `SCHEMA_ERROR{path,message}` and computes `UNKNOWN_FIELD` warnings for containers via an explicit known-key walker (no Zod internals → version-robust).

**Tech Stack:** TypeScript (ESM), Zod v4 (`looseObject`/`strictObject`/`discriminatedUnion`/`safeParse`), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-05-novel2script-design.md` (v1.2) — implements §5 (Schema fields), §8 (profiles), and the schema/strictness portion of §10. The remaining validators (referential, anchor+fingerprint, constraints, quality_report) and YAML conversion are **Plan 3**.

---

## Scope & sequencing

- **Plan 1 (done):** parsing + paragraph IDs + entity normalization. Exports types this plan does not need to modify.
- **Plan 2 (this doc):** Zod schema + inferred types + `KNOWN_KEYS` + adaptation profiles + structural `validateSchema`.
- **Schema design doc (D2):** authored by the lead immediately after this plan's schema lands (it is prose tied to design rationale and must mirror the final `script-schema.ts`; not a subagent task).
- **Plan 3:** `referential`, `anchor`+`fingerprint`, `constraints`, `quality-report`, `yaml` convert.
- **Plan 4:** Next.js scaffold + `FixtureProvider` + demo novel + API + minimal UI + README.
- **Plan 5 (P1):** `LiveLLMProvider` 3-stage + reliability/degradation.

**Branch:** create `feat/schema-validation` off the current `feat/core-parsing` HEAD (this layer depends on Plan 1's code, which is not yet merged to `main`).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/schema/script-schema.ts` | The Zod schema for the whole Script YAML + inferred types (`Script`, `Beat`, `AdaptationConstraints`, `AdaptationProfile`) + `ADAPTATION_PROFILES` + `KNOWN_KEYS` registry |
| `src/core/schema/profiles.ts` | `getProfileConstraints(profile)` → default `adaptation_constraints` per profile |
| `src/core/validate/schema-validate.ts` | `validateSchema(obj)` → `{valid, errors, warnings}`; `formatPath`; container `UNKNOWN_FIELD` walker |
| `tests/core/script-schema.test.ts`, `tests/core/profiles.test.ts`, `tests/core/schema-validate.test.ts` | one test file per module |

---

## Task 1: Add Zod as a runtime dependency

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Create the feature branch (off the current branch)**

Run:
```bash
git -C "e:/QQ下载及记录/jianli/ai-agent/aitransfer" rev-parse --abbrev-ref HEAD   # expect: feat/core-parsing
git -C "e:/QQ下载及记录/jianli/ai-agent/aitransfer" checkout -b feat/schema-validation
```
Expected: `Switched to a new branch 'feat/schema-validation'`

- [ ] **Step 2: Install Zod**

Run (from project root, do NOT cd): `npm install zod`
Expected: `zod` added under `dependencies` in `package.json` (a v4.x version), `node_modules/zod` present.

- [ ] **Step 3: Sanity-confirm Zod imports under ESM**

Run: `npx vitest run tests/core/sanity.test.ts`
Expected: PASS (the existing sanity test still passes; this just confirms the toolchain is intact after install).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(core): add zod runtime dependency" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: The screenplay Zod schema (`script-schema.ts`)

**Files:**
- Create: `src/core/schema/script-schema.ts`
- Test: `tests/core/script-schema.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/script-schema.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { ScriptSchema, BeatSchema, KNOWN_KEYS } from "../../src/core/schema/script-schema";

/** A complete, valid Script object. Tests clone and mutate it to probe failures. */
function validScript() {
  return {
    schema_version: "1.0",
    metadata: {
      title: "雾港旧约",
      source_type: "novel",
      target_format: "screenplay",
      adaptation_profile: "short_drama",
      language: "zh-CN",
      created_at: "2026-06-05T00:00:00Z",
      generator: { model: "fixture", mode: "fixture" },
      source_fingerprint: "abc123def456",
    },
    adaptation_constraints: {
      structure_unit: "episode",
      episode_count: 3,
      target_duration_seconds_per_episode: 120,
      opening_hook_required: true,
      cliffhanger_required: true,
      fidelity_level: "balanced",
    },
    source_chapters: [{ id: "ch1", title: "归港", index: 1, summary: "林深归来。" }],
    source_paragraphs: [
      { id: "ch1_p1_a1b2c3d4", chapter_id: "ch1", paragraph_index: 1, text_preview: "林深回到旧码头。", hash: "a1b2c3d4" },
    ],
    characters: [
      { id: "char_abc123", name: "林深", aliases: ["老林"], role: "protagonist", motivation: "复仇", relationship_notes: "", source_refs: ["ch1_p1_a1b2c3d4"] },
    ],
    locations: [{ id: "loc_def456", name: "旧码头", description: "雾气弥漫。", source_refs: ["ch1_p1_a1b2c3d4"] }],
    episodes: [
      {
        episode_no: 1,
        title: "归来",
        opening_hook: "钩子",
        core_conflict: "冲突",
        cliffhanger: "悬念",
        estimated_duration_seconds: 120,
        scenes: [
          {
            scene_no: 1,
            heading: { int_ext: "EXT", location_id: "loc_def456", time_of_day: "NIGHT" },
            present_character_ids: ["char_abc123"],
            summary: "林深登岸。",
            beats: [
              { beat_no: 1, type: "action", source_refs: ["ch1_p1_a1b2c3d4"], description: "林深踏上栈桥。" },
              { beat_no: 2, type: "dialogue", source_refs: ["ch1_p1_a1b2c3d4"], character_id: "char_abc123", line: "三年了。" },
              { beat_no: 3, type: "transition", source_refs: [], transition_kind: "CUT_TO" },
            ],
            source_refs: ["ch1_p1_a1b2c3d4"],
          },
        ],
      },
    ],
    adaptation_notes: [{ type: "merge", description: "合并次要船员。", source_refs: [] }],
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
}

describe("ScriptSchema", () => {
  it("accepts a complete valid script", () => {
    expect(ScriptSchema.safeParse(validScript()).success).toBe(true);
  });

  it("rejects a missing required field", () => {
    const s = validScript();
    delete (s.metadata as Record<string, unknown>).title;
    expect(ScriptSchema.safeParse(s).success).toBe(false);
  });

  it("rejects an invalid enum value", () => {
    const s = validScript();
    s.episodes[0]!.scenes[0]!.heading.time_of_day = "MIDNIGHT";
    expect(ScriptSchema.safeParse(s).success).toBe(false);
  });

  it("keeps unknown keys on container objects (looseObject, not dropped)", () => {
    const s = validScript();
    (s.metadata as Record<string, unknown>).custom_note = "作者批注";
    const r = ScriptSchema.safeParse(s);
    expect(r.success).toBe(true);
    expect(r.success && (r.data.metadata as Record<string, unknown>).custom_note).toBe("作者批注");
  });

  it("rejects a beat carrying a field from another beat type (beats are strict)", () => {
    const s = validScript();
    (s.episodes[0]!.scenes[0]!.beats[1] as Record<string, unknown>).description = "越界字段";
    expect(ScriptSchema.safeParse(s).success).toBe(false);
  });

  it("rejects a dialogue beat missing its required line", () => {
    const s = validScript();
    delete (s.episodes[0]!.scenes[0]!.beats[1] as Record<string, unknown>).line;
    expect(ScriptSchema.safeParse(s).success).toBe(false);
  });
});

describe("BeatSchema", () => {
  it("accepts each beat variant", () => {
    expect(BeatSchema.safeParse({ beat_no: 1, type: "action", source_refs: [], description: "x" }).success).toBe(true);
    expect(BeatSchema.safeParse({ beat_no: 1, type: "dialogue", source_refs: [], character_id: "c", line: "hi" }).success).toBe(true);
    expect(BeatSchema.safeParse({ beat_no: 1, type: "transition", source_refs: [], transition_kind: "FADE_OUT" }).success).toBe(true);
  });
  it("rejects an unknown beat type", () => {
    expect(BeatSchema.safeParse({ beat_no: 1, type: "song", source_refs: [] }).success).toBe(false);
  });
});

describe("KNOWN_KEYS", () => {
  it("lists the top-level keys", () => {
    expect(KNOWN_KEYS.root).toContain("episodes");
    expect(KNOWN_KEYS.scene).toContain("beats");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/script-schema.test.ts`
Expected: FAIL — cannot resolve `../../src/core/schema/script-schema`.

- [ ] **Step 3: Implement `src/core/schema/script-schema.ts`**

```ts
import { z } from "zod";

export const SCHEMA_VERSION = "1.0";

/** Adaptation profiles (short_drama is the v1 default/showcase). */
export const ADAPTATION_PROFILES = ["short_drama", "film", "series", "custom"] as const;
export type AdaptationProfile = (typeof ADAPTATION_PROFILES)[number];

// ---- enums ----
const StructureUnit = z.enum(["episode", "act"]);
const FidelityLevel = z.enum(["faithful", "balanced", "creative"]);
const GeneratorMode = z.enum(["live", "fixture"]);
const CharacterRole = z.enum(["protagonist", "antagonist", "supporting", "minor"]);
const IntExt = z.enum(["INT", "EXT", "INT_EXT"]);
const TimeOfDay = z.enum(["DAY", "NIGHT", "DAWN", "DUSK", "CONTINUOUS"]);
const TransitionKind = z.enum(["CUT_TO", "FADE_OUT", "FADE_IN", "DISSOLVE_TO", "SMASH_CUT"]);
const AdaptationNoteType = z.enum(["cut", "merge", "reorder", "original_addition", "pacing"]);

// ---- containers: looseObject (keep unknown keys; warnings handled by the validator) ----
const Generator = z.looseObject({
  model: z.string(),
  mode: GeneratorMode,
});

const Metadata = z.looseObject({
  title: z.string(),
  source_type: z.literal("novel"),
  target_format: z.literal("screenplay"),
  adaptation_profile: z.enum(ADAPTATION_PROFILES),
  language: z.string(),
  created_at: z.string(),
  generator: Generator,
  source_fingerprint: z.string(),
});

export const AdaptationConstraintsSchema = z.looseObject({
  structure_unit: StructureUnit,
  episode_count: z.number().int().min(1),
  target_duration_seconds_per_episode: z.number().int().min(1),
  opening_hook_required: z.boolean(),
  cliffhanger_required: z.boolean(),
  fidelity_level: FidelityLevel,
});

const SourceChapter = z.looseObject({
  id: z.string(),
  title: z.string(),
  index: z.number().int().min(1),
  summary: z.string(),
});

const SourceParagraph = z.looseObject({
  id: z.string(),
  chapter_id: z.string(),
  paragraph_index: z.number().int().min(1),
  text_preview: z.string(),
  hash: z.string(),
});

const Character = z.looseObject({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  role: CharacterRole,
  motivation: z.string(),
  relationship_notes: z.string(),
  source_refs: z.array(z.string()),
});

const Location = z.looseObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  source_refs: z.array(z.string()),
});

// ---- beats: discriminated union of STRICT variants (the one strict exception) ----
const DialogueBeat = z.strictObject({
  beat_no: z.number().int().min(1),
  type: z.literal("dialogue"),
  source_refs: z.array(z.string()),
  character_id: z.string(),
  line: z.string(),
  parenthetical: z.string().optional(),
});
const ActionBeat = z.strictObject({
  beat_no: z.number().int().min(1),
  type: z.literal("action"),
  source_refs: z.array(z.string()),
  description: z.string(),
});
const TransitionBeat = z.strictObject({
  beat_no: z.number().int().min(1),
  type: z.literal("transition"),
  source_refs: z.array(z.string()),
  transition_kind: TransitionKind,
});
export const BeatSchema = z.discriminatedUnion("type", [DialogueBeat, ActionBeat, TransitionBeat]);

const Heading = z.looseObject({
  int_ext: IntExt,
  location_id: z.string(),
  time_of_day: TimeOfDay,
});

const Scene = z.looseObject({
  scene_no: z.number().int().min(1),
  heading: Heading,
  present_character_ids: z.array(z.string()),
  summary: z.string(),
  beats: z.array(BeatSchema),
  source_refs: z.array(z.string()),
});

const Episode = z.looseObject({
  episode_no: z.number().int().min(1),
  title: z.string(),
  opening_hook: z.string(),
  core_conflict: z.string(),
  cliffhanger: z.string(),
  estimated_duration_seconds: z.number().int().min(1),
  scenes: z.array(Scene),
});

const AdaptationNote = z.looseObject({
  type: AdaptationNoteType,
  description: z.string(),
  source_refs: z.array(z.string()).optional(),
});

const QualityReport = z.looseObject({
  source_coverage_ratio: z.number().min(0).max(1),
  referenced_paragraph_count: z.number().int().min(0),
  total_paragraph_count: z.number().int().min(0),
  missing_source_refs: z.array(z.string()),
  repaired_refs: z.array(z.string()),
  untraceable_scenes: z.array(z.string()),
  unreferenced_key_paragraphs: z.array(z.string()),
  constraint_warnings: z.array(z.looseObject({ code: z.string(), message: z.string() })),
  manual_review_suggestions: z.array(z.string()),
});

export const ScriptSchema = z.looseObject({
  schema_version: z.literal(SCHEMA_VERSION),
  metadata: Metadata,
  adaptation_constraints: AdaptationConstraintsSchema,
  source_chapters: z.array(SourceChapter),
  source_paragraphs: z.array(SourceParagraph),
  characters: z.array(Character),
  locations: z.array(Location),
  episodes: z.array(Episode),
  adaptation_notes: z.array(AdaptationNote),
  quality_report: QualityReport,
});

export type Script = z.infer<typeof ScriptSchema>;
export type Beat = z.infer<typeof BeatSchema>;
export type AdaptationConstraints = z.infer<typeof AdaptationConstraintsSchema>;

/**
 * Allowed keys per container object, used by the validator to emit non-blocking
 * UNKNOWN_FIELD warnings (containers are looseObject so unknown keys are KEPT, not
 * errored). Must stay in sync with the schemas above. Beats are validated strictly
 * by Zod and are intentionally NOT listed here.
 */
export const KNOWN_KEYS = {
  root: ["schema_version", "metadata", "adaptation_constraints", "source_chapters", "source_paragraphs", "characters", "locations", "episodes", "adaptation_notes", "quality_report"],
  metadata: ["title", "source_type", "target_format", "adaptation_profile", "language", "created_at", "generator", "source_fingerprint"],
  generator: ["model", "mode"],
  adaptation_constraints: ["structure_unit", "episode_count", "target_duration_seconds_per_episode", "opening_hook_required", "cliffhanger_required", "fidelity_level"],
  source_chapter: ["id", "title", "index", "summary"],
  source_paragraph: ["id", "chapter_id", "paragraph_index", "text_preview", "hash"],
  character: ["id", "name", "aliases", "role", "motivation", "relationship_notes", "source_refs"],
  location: ["id", "name", "description", "source_refs"],
  episode: ["episode_no", "title", "opening_hook", "core_conflict", "cliffhanger", "estimated_duration_seconds", "scenes"],
  scene: ["scene_no", "heading", "present_character_ids", "summary", "beats", "source_refs"],
  heading: ["int_ext", "location_id", "time_of_day"],
  adaptation_note: ["type", "description", "source_refs"],
  quality_report: ["source_coverage_ratio", "referenced_paragraph_count", "total_paragraph_count", "missing_source_refs", "repaired_refs", "untraceable_scenes", "unreferenced_key_paragraphs", "constraint_warnings", "manual_review_suggestions"],
} as const;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/core/script-schema.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/schema/script-schema.ts tests/core/script-schema.test.ts
git commit -m "feat(core): screenplay zod schema (containers loose, beats strict)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Adaptation profiles (`profiles.ts`)

**Files:**
- Create: `src/core/schema/profiles.ts`
- Test: `tests/core/profiles.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/profiles.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { getProfileConstraints } from "../../src/core/schema/profiles";
import { ADAPTATION_PROFILES, AdaptationConstraintsSchema } from "../../src/core/schema/script-schema";

describe("getProfileConstraints", () => {
  it("returns the short_drama preset (3 episodes x 120s, hook+cliffhanger required)", () => {
    expect(getProfileConstraints("short_drama")).toEqual({
      structure_unit: "episode",
      episode_count: 3,
      target_duration_seconds_per_episode: 120,
      opening_hook_required: true,
      cliffhanger_required: true,
      fidelity_level: "balanced",
    });
  });

  it("uses act structure for film", () => {
    expect(getProfileConstraints("film").structure_unit).toBe("act");
  });

  it("returns constraints that satisfy AdaptationConstraintsSchema for every profile", () => {
    for (const p of ADAPTATION_PROFILES) {
      expect(AdaptationConstraintsSchema.safeParse(getProfileConstraints(p)).success).toBe(true);
    }
  });

  it("returns a fresh copy each call (no shared mutable state)", () => {
    const a = getProfileConstraints("short_drama");
    a.episode_count = 99;
    expect(getProfileConstraints("short_drama").episode_count).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/profiles.test.ts`
Expected: FAIL — cannot resolve `../../src/core/schema/profiles`.

- [ ] **Step 3: Implement `src/core/schema/profiles.ts`**

```ts
import type { AdaptationProfile, AdaptationConstraints } from "./script-schema";

/**
 * Default adaptation_constraints per profile (spec §8). short_drama is the v1 default
 * and showcase preset; the others are sane starting points the author can override.
 */
const PROFILE_DEFAULTS: Record<AdaptationProfile, AdaptationConstraints> = {
  short_drama: {
    structure_unit: "episode",
    episode_count: 3,
    target_duration_seconds_per_episode: 120,
    opening_hook_required: true,
    cliffhanger_required: true,
    fidelity_level: "balanced",
  },
  film: {
    structure_unit: "act",
    episode_count: 3,
    target_duration_seconds_per_episode: 1800,
    opening_hook_required: false,
    cliffhanger_required: false,
    fidelity_level: "balanced",
  },
  series: {
    structure_unit: "episode",
    episode_count: 6,
    target_duration_seconds_per_episode: 1500,
    opening_hook_required: true,
    cliffhanger_required: false,
    fidelity_level: "balanced",
  },
  custom: {
    structure_unit: "episode",
    episode_count: 3,
    target_duration_seconds_per_episode: 120,
    opening_hook_required: false,
    cliffhanger_required: false,
    fidelity_level: "balanced",
  },
};

/** Return a fresh copy of the default constraints for a profile. */
export function getProfileConstraints(profile: AdaptationProfile): AdaptationConstraints {
  return { ...PROFILE_DEFAULTS[profile] };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/core/profiles.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/schema/profiles.ts tests/core/profiles.test.ts
git commit -m "feat(core): adaptation profiles (short_drama preset + film/series/custom)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Structural validator (`schema-validate.ts`)

**Files:**
- Create: `src/core/validate/schema-validate.ts`
- Test: `tests/core/schema-validate.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/schema-validate.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { validateSchema, formatPath } from "../../src/core/validate/schema-validate";

function validScript() {
  return {
    schema_version: "1.0",
    metadata: {
      title: "雾港旧约", source_type: "novel", target_format: "screenplay",
      adaptation_profile: "short_drama", language: "zh-CN", created_at: "2026-06-05T00:00:00Z",
      generator: { model: "fixture", mode: "fixture" }, source_fingerprint: "abc123",
    },
    adaptation_constraints: {
      structure_unit: "episode", episode_count: 3, target_duration_seconds_per_episode: 120,
      opening_hook_required: true, cliffhanger_required: true, fidelity_level: "balanced",
    },
    source_chapters: [{ id: "ch1", title: "归港", index: 1, summary: "s" }],
    source_paragraphs: [{ id: "ch1_p1_a1b2c3d4", chapter_id: "ch1", paragraph_index: 1, text_preview: "p", hash: "a1b2c3d4" }],
    characters: [{ id: "char_abc123", name: "林深", aliases: [], role: "protagonist", motivation: "m", relationship_notes: "", source_refs: ["ch1_p1_a1b2c3d4"] }],
    locations: [{ id: "loc_def456", name: "旧码头", description: "", source_refs: [] }],
    episodes: [{
      episode_no: 1, title: "归来", opening_hook: "h", core_conflict: "c", cliffhanger: "cl",
      estimated_duration_seconds: 120,
      scenes: [{
        scene_no: 1, heading: { int_ext: "EXT", location_id: "loc_def456", time_of_day: "NIGHT" },
        present_character_ids: ["char_abc123"], summary: "s",
        beats: [
          { beat_no: 1, type: "action", source_refs: ["ch1_p1_a1b2c3d4"], description: "d" },
          { beat_no: 2, type: "dialogue", source_refs: ["ch1_p1_a1b2c3d4"], character_id: "char_abc123", line: "l" },
        ],
        source_refs: ["ch1_p1_a1b2c3d4"],
      }],
    }],
    adaptation_notes: [{ type: "merge", description: "d", source_refs: [] }],
    quality_report: {
      source_coverage_ratio: 1, referenced_paragraph_count: 1, total_paragraph_count: 1,
      missing_source_refs: [], repaired_refs: [], untraceable_scenes: [],
      unreferenced_key_paragraphs: [], constraint_warnings: [], manual_review_suggestions: [],
    },
  };
}

describe("formatPath", () => {
  it("renders array indices as [n] and keys with dots", () => {
    expect(formatPath(["episodes", 1, "scenes", 0, "beats", 3, "source_refs", 2]))
      .toBe("episodes[1].scenes[0].beats[3].source_refs[2]");
  });
  it("renders a leading key without a leading dot", () => {
    expect(formatPath(["metadata", "title"])).toBe("metadata.title");
  });
});

describe("validateSchema", () => {
  it("reports a valid script with no errors or warnings", () => {
    const r = validateSchema(validScript());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("flags a missing required field as SCHEMA_ERROR with its path", () => {
    const s = validScript();
    delete (s.metadata as Record<string, unknown>).title;
    const r = validateSchema(s);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCHEMA_ERROR" && e.path === "metadata.title")).toBe(true);
  });

  it("flags a beat with a foreign field as SCHEMA_ERROR pointing at the beat", () => {
    const s = validScript();
    (s.episodes[0]!.scenes[0]!.beats[1] as Record<string, unknown>).description = "越界";
    const r = validateSchema(s);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCHEMA_ERROR" && e.path.includes("episodes[0].scenes[0].beats[1]"))).toBe(true);
  });

  it("emits a non-blocking UNKNOWN_FIELD warning for an unknown container key (still valid)", () => {
    const s = validScript();
    (s.metadata as Record<string, unknown>).custom_note = "批注";
    const r = validateSchema(s);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.code === "UNKNOWN_FIELD" && w.path === "metadata.custom_note")).toBe(true);
  });

  it("warns about an unknown top-level key", () => {
    const s = validScript();
    (s as Record<string, unknown>).extra_top = 1;
    const r = validateSchema(s);
    expect(r.warnings.some((w) => w.code === "UNKNOWN_FIELD" && w.path === "extra_top")).toBe(true);
  });

  it("flags an invalid enum value as an error", () => {
    const s = validScript();
    s.episodes[0]!.scenes[0]!.heading.time_of_day = "MIDNIGHT";
    expect(validateSchema(s).valid).toBe(false);
  });

  it("does not throw on non-object input", () => {
    expect(validateSchema(null).valid).toBe(false);
    expect(validateSchema("nope").valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/schema-validate.test.ts`
Expected: FAIL — cannot resolve `../../src/core/validate/schema-validate`.

- [ ] **Step 3: Implement `src/core/validate/schema-validate.ts`**

```ts
import { ScriptSchema, KNOWN_KEYS } from "../schema/script-schema";

export interface ValidationItem {
  path: string;
  code: string; // SCHEMA_ERROR | UNKNOWN_FIELD
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: ValidationItem[];
  warnings: ValidationItem[];
}

/** Render a Zod issue path like ["episodes",1,"scenes",0] into "episodes[1].scenes[0]". */
export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out ? `.${String(seg)}` : String(seg);
  }
  return out;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function checkKeys(obj: unknown, known: readonly string[], path: string, out: ValidationItem[]): void {
  const rec = asRecord(obj);
  if (!rec) return;
  for (const k of Object.keys(rec)) {
    if (!known.includes(k)) {
      out.push({ path: path ? `${path}.${k}` : k, code: "UNKNOWN_FIELD", message: `未知字段：${k}` });
    }
  }
}

/**
 * Walk the known container structure and flag unknown keys as non-blocking warnings.
 * Containers are looseObject (unknown keys are kept, not errored), so warnings are how
 * the author learns about stray fields. Beats are validated strictly by Zod, so they are
 * intentionally not walked here.
 */
function collectUnknownFieldWarnings(input: unknown): ValidationItem[] {
  const out: ValidationItem[] = [];
  const root = asRecord(input);
  if (!root) return out;

  checkKeys(root, KNOWN_KEYS.root, "", out);
  checkKeys(root.metadata, KNOWN_KEYS.metadata, "metadata", out);
  checkKeys(asRecord(root.metadata)?.generator, KNOWN_KEYS.generator, "metadata.generator", out);
  checkKeys(root.adaptation_constraints, KNOWN_KEYS.adaptation_constraints, "adaptation_constraints", out);
  asArray(root.source_chapters).forEach((c, i) => checkKeys(c, KNOWN_KEYS.source_chapter, `source_chapters[${i}]`, out));
  asArray(root.source_paragraphs).forEach((p, i) => checkKeys(p, KNOWN_KEYS.source_paragraph, `source_paragraphs[${i}]`, out));
  asArray(root.characters).forEach((c, i) => checkKeys(c, KNOWN_KEYS.character, `characters[${i}]`, out));
  asArray(root.locations).forEach((l, i) => checkKeys(l, KNOWN_KEYS.location, `locations[${i}]`, out));
  asArray(root.episodes).forEach((e, i) => {
    checkKeys(e, KNOWN_KEYS.episode, `episodes[${i}]`, out);
    asArray(asRecord(e)?.scenes).forEach((s, j) => {
      const base = `episodes[${i}].scenes[${j}]`;
      checkKeys(s, KNOWN_KEYS.scene, base, out);
      checkKeys(asRecord(s)?.heading, KNOWN_KEYS.heading, `${base}.heading`, out);
    });
  });
  asArray(root.adaptation_notes).forEach((n, i) => checkKeys(n, KNOWN_KEYS.adaptation_note, `adaptation_notes[${i}]`, out));
  checkKeys(root.quality_report, KNOWN_KEYS.quality_report, "quality_report", out);
  return out;
}

/**
 * Structural validation of a parsed Script object (spec §10).
 * Hard errors come from Zod (containers lenient, beats strict); every Zod issue maps to
 * one SCHEMA_ERROR{path,message}. Unknown container keys are non-blocking UNKNOWN_FIELD
 * warnings. (Referential/anchor/constraint checks live in Plan 3.)
 */
export function validateSchema(input: unknown): SchemaValidationResult {
  const errors: ValidationItem[] = [];
  const result = ScriptSchema.safeParse(input);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push({ path: formatPath(issue.path), code: "SCHEMA_ERROR", message: issue.message });
    }
  }
  const warnings = collectUnknownFieldWarnings(input);
  return { valid: errors.length === 0, errors, warnings };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/core/schema-validate.test.ts`
Expected: PASS (9 tests). If the beat-foreign-field path assertion fails, inspect the actual `r.errors` paths — the Zod `unrecognized_keys` issue path should point at `episodes[0].scenes[0].beats[1]`; adjust nothing in the impl, the assertion uses `.includes(...)` to tolerate the exact tail.

- [ ] **Step 5: Commit**

```bash
git add src/core/validate/schema-validate.ts tests/core/schema-validate.test.ts
git commit -m "feat(core): structural validator (path-precise errors + UNKNOWN_FIELD warnings)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Green gate — full suite + typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all files, ~58 tests (36 from Plan 1 + 9 + 4 + 9 here = 58).

- [ ] **Step 2: Run the type checker**

Run: `npm run typecheck`
Expected: no errors, exit 0.

- [ ] **Step 3: Commit (no-op if clean)**

```bash
git status --short
# If anything is uncommitted: git add -A && git commit -m "test(core): green suite for schema + validation layer" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## After this plan: Schema design doc (D2)

Once Task 5 is green, the lead authors `docs/script-yaml-schema.md` directly (not a subagent task): a prose document that (a) defines every section/field of the YAML Schema using `src/core/schema/script-schema.ts` as the source of truth, (b) explains the design rationale (stable IDs & verifiable `source_refs`; constraints-in-YAML; episodes→scenes→ordered beats; referential integrity via IDs; containers-lenient / beats-strict; JSON-validated-then-YAML; `source_fingerprint` anchoring; system-computed `quality_report`), and (c) includes a complete annotated example. This satisfies the题目's required Schema document.

---

## Self-Review — Spec Coverage (Plan 2 scope)

| Spec item | Covered by |
|---|---|
| §5.1 顶层结构（10 个区块） | Task 2 `ScriptSchema` |
| §5 各区块字段 + 枚举（metadata/constraints/chapters/paragraphs/characters/locations/episodes/scenes/beats/notes/quality_report） | Task 2 |
| §5 场景单一有序 `beats`（dialogue/action/transition 判别联合） | Task 2 `BeatSchema` |
| §8 profiles（short_drama 默认 + film/series/custom） | Task 3 |
| §10 容器宽松（looseObject 保留未知键）/ beats 严格（strictObject 越界即错） | Tasks 2, 4 |
| §10 错误对象 `{path,code,message}` + 路径格式 `a[i].b` | Task 4 `formatPath`/`validateSchema` |
| §10 `UNKNOWN_FIELD` 告警不硬失败 | Task 4 walker |
| §10 `SCHEMA_ERROR` 硬失败（缺必填/错枚举/beat 越界） | Task 4 |
| D2 Schema 设计文档 | authored after Task 5 (separate, see above) |

**Out of scope here (Plan 3):** `INVALID_SOURCE_REF`/`INVALID_CHARACTER_REF`/`INVALID_LOCATION_REF` (referential), `SOURCE_MISMATCH`/`source_fingerprint` (anchor), `CONSTRAINT_VIOLATION`/`CONSTRAINT_WARNING` (constraints), `quality_report` recompute, YAML conversion.

**Type/name consistency:** `ScriptSchema`/`BeatSchema`/`AdaptationConstraintsSchema`/`KNOWN_KEYS`/`ADAPTATION_PROFILES` are defined in `script-schema.ts` and imported with those exact names in `profiles.ts` and `schema-validate.ts` and the tests. `getProfileConstraints(profile)` signature matches its test. `validateSchema(input)`/`formatPath(path)` match their tests. `KNOWN_KEYS` arrays were written to mirror each Zod schema's keys exactly (used by the walker). No placeholders.
