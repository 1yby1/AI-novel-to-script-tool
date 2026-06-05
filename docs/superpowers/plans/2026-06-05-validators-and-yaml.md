# Validators & YAML Conversion Layer — Implementation Plan (Plan 3, P0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the deterministic core: a source `fingerprint`, referential-integrity / canonical-anchor / short-drama-constraint validators, a recomputed `quality_report`, and JSON↔YAML conversion — so "novel → verifiable, traceable YAML screenplay" works end-to-end without AI.

**Architecture:** Pure TypeScript continuing Plans 1–2. The validators assume a **structurally valid** `Script` (caller runs `validateSchema` first), so they are typed against the inferred `Script` and return arrays of `ValidationItem` (reusing the type from Plan 2). `quality_report` is always recomputed from the script (never trusts an embedded one). YAML conversion uses the `yaml` package; parse failures become a `YAML_SYNTAX_ERROR` item rather than throwing.

**Tech Stack:** TypeScript (ESM), `yaml` (v2: `parse`/`stringify`), Node `crypto`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-05-novel2script-design.md` (v1.2) — implements §4 (referential + anchor + fingerprint), §10 (constraint checks, error codes), §11 (quality_report compute + traceability), and the YAML conversion of §13. The HTTP routes, fixture provider, UI and live-LLM orchestration are later plans.

---

## Scope & sequencing

- **Plans 1–2 (done):** parsing + IDs; Zod schema + profiles + structural `validateSchema`.
- **Plan 3 (this doc):** `fingerprint`, `referential`, `anchor`, `constraints`, `quality-report`, `yaml` convert.
- **Plan 4:** Next.js scaffold + `FixtureProvider` + original demo novel + API routes (compose all validators) + minimal workbench UI + README.
- **Plan 5 (P1):** `LiveLLMProvider` 3-stage + reliability/degradation.

**Branch:** create `feat/validators-yaml` off the current `feat/schema-validation` HEAD (depends on Plans 1–2).

**Reused types (do not redefine):** `ValidationItem { path, code, message }` and `formatPath` from `src/core/validate/schema-validate.ts`; `Script` from `src/core/schema/script-schema.ts`.

---

## File Structure

| File | Responsibility |
|---|---|
| `tests/helpers/valid-script.ts` | Shared test fixture: `validScript()` → a fresh, schema-valid, constraint-clean `Script` |
| `src/core/parse/fingerprint.ts` | `computeSourceFingerprint(paragraphs)` — deterministic source anchor hash |
| `src/core/validate/referential.ts` | `checkReferential(script)` — source_ref / character_id / location_id / chapter_id existence |
| `src/core/validate/anchor.ts` | `checkAnchor(script, canonical?)` — YAML ⊆ canonical + fingerprint match; `SOURCE_UNVERIFIED` when standalone |
| `src/core/validate/constraints.ts` | `checkConstraints(script)` — episode count / duration / hook / cliffhanger → `CONSTRAINT_WARNING` |
| `src/core/validate/quality-report.ts` | `computeQualityReport(script, input?)` — coverage / missing / untraceable / suggestions (recomputed) |
| `src/core/yaml/convert.ts` | `scriptToYaml(script)` / `parseScriptYaml(text)` |
| `tests/core/*.test.ts` | one test file per module |

---

## Task 1: Add `yaml` + shared valid-script fixture

**Files:**
- `package.json`, `package-lock.json`
- Create: `tests/helpers/valid-script.ts`, `tests/core/valid-script-fixture.test.ts`

- [ ] **Step 1: Create the feature branch**

```bash
git -C "e:/QQ下载及记录/jianli/ai-agent/aitransfer" rev-parse --abbrev-ref HEAD   # expect: feat/schema-validation
git -C "e:/QQ下载及记录/jianli/ai-agent/aitransfer" checkout -b feat/validators-yaml
```

- [ ] **Step 2: Install yaml**

Run (from project root, do NOT cd): `npm install yaml`
Expected: `yaml` added under `dependencies` (a v2.x version).

- [ ] **Step 3: Create the shared fixture** — `tests/helpers/valid-script.ts`

```ts
import type { Script } from "../../src/core/schema/script-schema";

/**
 * A fresh, schema-valid, constraint-clean Script (short_drama: 3 episodes, hook+cliffhanger
 * present, full source coverage). Tests clone via this factory and mutate to probe failures.
 * Entity/paragraph IDs are arbitrary opaque strings (the schema validates them as strings;
 * referential checks verify existence, not format).
 */
export function validScript(): Script {
  const episode = (n: number, pid: string) => ({
    episode_no: n,
    title: `第${n}集`,
    opening_hook: n === 1 ? "强钩子：他回来了。" : `第${n}集开场。`,
    core_conflict: "核心冲突。",
    cliffhanger: "结尾悬念。",
    estimated_duration_seconds: 120,
    scenes: [
      {
        scene_no: 1,
        heading: { int_ext: "EXT" as const, location_id: "loc_dock", time_of_day: "NIGHT" as const },
        present_character_ids: ["char_lin"],
        summary: "场景摘要。",
        beats: [
          { beat_no: 1, type: "action" as const, source_refs: [pid], description: "动作描述。" },
          { beat_no: 2, type: "dialogue" as const, source_refs: [pid], character_id: "char_lin", line: "台词。" },
        ],
        source_refs: [pid],
      },
    ],
  });

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
      source_fingerprint: "0000000000000000",
    },
    adaptation_constraints: {
      structure_unit: "episode",
      episode_count: 3,
      target_duration_seconds_per_episode: 120,
      opening_hook_required: true,
      cliffhanger_required: true,
      fidelity_level: "balanced",
    },
    source_chapters: [
      { id: "ch1", title: "归港", index: 1, summary: "摘要一。" },
      { id: "ch2", title: "重逢", index: 2, summary: "摘要二。" },
      { id: "ch3", title: "抉择", index: 3, summary: "摘要三。" },
    ],
    source_paragraphs: [
      { id: "ch1_p1_aaaa1111", chapter_id: "ch1", paragraph_index: 1, text_preview: "林深回到了旧码头，海风很冷。", hash: "aaaa1111" },
      { id: "ch2_p1_bbbb2222", chapter_id: "ch2", paragraph_index: 1, text_preview: "她在灯塔下等了他三年之久。", hash: "bbbb2222" },
      { id: "ch3_p1_cccc3333", chapter_id: "ch3", paragraph_index: 1, text_preview: "他终于必须做出那个选择了。", hash: "cccc3333" },
    ],
    characters: [
      { id: "char_lin", name: "林深", aliases: ["老林"], role: "protagonist", motivation: "查清真相", relationship_notes: "与苏晚旧识", source_refs: ["ch1_p1_aaaa1111"] },
    ],
    locations: [
      { id: "loc_dock", name: "旧码头", description: "雾气弥漫。", source_refs: ["ch1_p1_aaaa1111"] },
    ],
    episodes: [episode(1, "ch1_p1_aaaa1111"), episode(2, "ch2_p1_bbbb2222"), episode(3, "ch3_p1_cccc3333")],
    adaptation_notes: [
      { type: "merge", description: "合并次要船员。", source_refs: ["ch1_p1_aaaa1111"] },
    ],
    quality_report: {
      source_coverage_ratio: 1,
      referenced_paragraph_count: 3,
      total_paragraph_count: 3,
      missing_source_refs: [],
      repaired_refs: [],
      untraceable_scenes: [],
      unreferenced_key_paragraphs: [],
      constraint_warnings: [],
      manual_review_suggestions: [],
    },
  };
}
```

- [ ] **Step 4: Write a test that guards the fixture** — `tests/core/valid-script-fixture.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { validScript } from "../helpers/valid-script";
import { validateSchema } from "../../src/core/validate/schema-validate";

describe("validScript fixture", () => {
  it("is structurally schema-valid with no warnings", () => {
    const r = validateSchema(validScript());
    expect(r.valid).toBe(true);
    expect(r.warnings).toEqual([]);
  });
  it("returns a fresh object each call", () => {
    const a = validScript();
    a.episodes = [];
    expect(validScript().episodes).toHaveLength(3);
  });
});
```

- [ ] **Step 5: Run the test** — `npx vitest run tests/core/valid-script-fixture.test.ts` — expect PASS (2 tests). If schema-invalid, fix the fixture (not the schema).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tests/helpers/valid-script.ts tests/core/valid-script-fixture.test.ts
git commit -m "chore(core): add yaml dep + shared valid-script test fixture" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Source fingerprint (`fingerprint.ts`)

**Files:** Create `src/core/parse/fingerprint.ts`; Test `tests/core/fingerprint.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/fingerprint.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { computeSourceFingerprint } from "../../src/core/parse/fingerprint";

describe("computeSourceFingerprint", () => {
  it("returns 16 lowercase hex chars", () => {
    expect(computeSourceFingerprint([{ id: "ch1_p1_x" }])).toMatch(/^[0-9a-f]{16}$/);
  });
  it("is deterministic", () => {
    const ps = [{ id: "a" }, { id: "b" }];
    expect(computeSourceFingerprint(ps)).toBe(computeSourceFingerprint(ps));
  });
  it("changes if any paragraph id changes", () => {
    expect(computeSourceFingerprint([{ id: "a" }])).not.toBe(computeSourceFingerprint([{ id: "a2" }]));
  });
  it("is order-sensitive", () => {
    expect(computeSourceFingerprint([{ id: "a" }, { id: "b" }])).not.toBe(computeSourceFingerprint([{ id: "b" }, { id: "a" }]));
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/core/fingerprint.test.ts` — expect FAIL.

- [ ] **Step 3: Implement `src/core/parse/fingerprint.ts`**

```ts
import { createHash } from "node:crypto";

/**
 * Deterministic fingerprint of the source: first 16 hex of SHA-256 over the ordered
 * paragraph IDs. Each ID embeds a content hash + position, so the fingerprint changes if
 * any paragraph's content, order, or count changes. Used to anchor a YAML back to the
 * exact parse it came from (spec §4.4).
 */
export function computeSourceFingerprint(paragraphs: ReadonlyArray<{ id: string }>): string {
  const joined = paragraphs.map((p) => p.id).join("\n");
  return createHash("sha256").update(joined).digest("hex").slice(0, 16);
}
```

- [ ] **Step 4: Run** `npx vitest run tests/core/fingerprint.test.ts` — expect PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/parse/fingerprint.ts tests/core/fingerprint.test.ts
git commit -m "feat(core): deterministic source fingerprint" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Referential integrity (`referential.ts`)

**Files:** Create `src/core/validate/referential.ts`; Test `tests/core/referential.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/referential.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { checkReferential } from "../../src/core/validate/referential";
import { validScript } from "../helpers/valid-script";

describe("checkReferential", () => {
  it("returns no errors for a fully consistent script", () => {
    expect(checkReferential(validScript())).toEqual([]);
  });

  it("flags an invalid source_ref on a beat with its path", () => {
    const s = validScript();
    s.episodes[0]!.scenes[0]!.beats[0]!.source_refs = ["ch9_p9_nope"];
    const errs = checkReferential(s);
    expect(errs.some((e) => e.code === "INVALID_SOURCE_REF" && e.path === "episodes[0].scenes[0].beats[0].source_refs[0]")).toBe(true);
  });

  it("flags an invalid location_id", () => {
    const s = validScript();
    s.episodes[0]!.scenes[0]!.heading.location_id = "loc_missing";
    expect(checkReferential(s).some((e) => e.code === "INVALID_LOCATION_REF" && e.path === "episodes[0].scenes[0].heading.location_id")).toBe(true);
  });

  it("flags an invalid present_character_id and a dialogue beat character_id", () => {
    const s = validScript();
    s.episodes[0]!.scenes[0]!.present_character_ids = ["char_ghost"];
    const beat = s.episodes[0]!.scenes[0]!.beats[1]!;
    if (beat.type === "dialogue") beat.character_id = "char_ghost";
    const errs = checkReferential(s);
    expect(errs.filter((e) => e.code === "INVALID_CHARACTER_REF")).toHaveLength(2);
  });

  it("flags a paragraph whose chapter_id does not exist", () => {
    const s = validScript();
    s.source_paragraphs[0]!.chapter_id = "ch_nope";
    expect(checkReferential(s).some((e) => e.code === "INVALID_CHAPTER_REF" && e.path === "source_paragraphs[0].chapter_id")).toBe(true);
  });

  it("flags an invalid source_ref on a character", () => {
    const s = validScript();
    s.characters[0]!.source_refs = ["ch9_p9_nope"];
    expect(checkReferential(s).some((e) => e.code === "INVALID_SOURCE_REF" && e.path === "characters[0].source_refs[0]")).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/core/referential.test.ts` — expect FAIL.

- [ ] **Step 3: Implement `src/core/validate/referential.ts`**

```ts
import type { Script } from "../schema/script-schema";
import type { ValidationItem } from "./schema-validate";

/**
 * Internal referential integrity (spec §4.1–4.3, §4.5): every source_ref, location_id,
 * character_id and chapter_id resolves to a real entry within this script. Assumes the
 * input already passed structural validation (validateSchema).
 */
export function checkReferential(script: Script): ValidationItem[] {
  const errors: ValidationItem[] = [];
  const paragraphIds = new Set(script.source_paragraphs.map((p) => p.id));
  const chapterIds = new Set(script.source_chapters.map((c) => c.id));
  const characterIds = new Set(script.characters.map((c) => c.id));
  const locationIds = new Set(script.locations.map((l) => l.id));

  const checkRefs = (refs: ReadonlyArray<string>, basePath: string): void => {
    refs.forEach((ref, i) => {
      if (!paragraphIds.has(ref)) {
        errors.push({ path: `${basePath}[${i}]`, code: "INVALID_SOURCE_REF", message: `source_ref 不存在：${ref}` });
      }
    });
  };

  script.source_paragraphs.forEach((p, i) => {
    if (!chapterIds.has(p.chapter_id)) {
      errors.push({ path: `source_paragraphs[${i}].chapter_id`, code: "INVALID_CHAPTER_REF", message: `chapter_id 不存在：${p.chapter_id}` });
    }
  });

  script.characters.forEach((c, i) => checkRefs(c.source_refs, `characters[${i}].source_refs`));
  script.locations.forEach((l, i) => checkRefs(l.source_refs, `locations[${i}].source_refs`));
  script.adaptation_notes.forEach((n, i) => {
    if (n.source_refs) checkRefs(n.source_refs, `adaptation_notes[${i}].source_refs`);
  });

  script.episodes.forEach((ep, ei) => {
    ep.scenes.forEach((sc, si) => {
      const base = `episodes[${ei}].scenes[${si}]`;
      checkRefs(sc.source_refs, `${base}.source_refs`);
      if (!locationIds.has(sc.heading.location_id)) {
        errors.push({ path: `${base}.heading.location_id`, code: "INVALID_LOCATION_REF", message: `location_id 不存在：${sc.heading.location_id}` });
      }
      sc.present_character_ids.forEach((cid, ci) => {
        if (!characterIds.has(cid)) {
          errors.push({ path: `${base}.present_character_ids[${ci}]`, code: "INVALID_CHARACTER_REF", message: `character_id 不存在：${cid}` });
        }
      });
      sc.beats.forEach((b, bi) => {
        checkRefs(b.source_refs, `${base}.beats[${bi}].source_refs`);
        if (b.type === "dialogue" && !characterIds.has(b.character_id)) {
          errors.push({ path: `${base}.beats[${bi}].character_id`, code: "INVALID_CHARACTER_REF", message: `character_id 不存在：${b.character_id}` });
        }
      });
    });
  });

  return errors;
}
```

- [ ] **Step 4: Run** `npx vitest run tests/core/referential.test.ts` — expect PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/validate/referential.ts tests/core/referential.test.ts
git commit -m "feat(core): referential integrity (source/character/location/chapter refs)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Canonical anchor (`anchor.ts`)

**Files:** Create `src/core/validate/anchor.ts`; Test `tests/core/anchor.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/anchor.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { checkAnchor } from "../../src/core/validate/anchor";
import { computeSourceFingerprint } from "../../src/core/parse/fingerprint";
import { validScript } from "../helpers/valid-script";

function canonicalOf(s = validScript()) {
  const paragraphIds = s.source_paragraphs.map((p) => p.id);
  return { paragraphIds, fingerprint: computeSourceFingerprint(s.source_paragraphs) };
}

describe("checkAnchor (with canonical)", () => {
  it("passes when fingerprint and paragraphs match canonical", () => {
    const s = validScript();
    const canonical = canonicalOf(s);
    s.metadata.source_fingerprint = canonical.fingerprint;
    const r = checkAnchor(s, canonical);
    expect(r.errors).toEqual([]);
  });

  it("flags SOURCE_MISMATCH when the fingerprint differs", () => {
    const s = validScript();
    const canonical = canonicalOf(s);
    s.metadata.source_fingerprint = "deadbeefdeadbeef";
    expect(checkAnchor(s, canonical).errors.some((e) => e.code === "SOURCE_MISMATCH" && e.path === "metadata.source_fingerprint")).toBe(true);
  });

  it("flags SOURCE_MISMATCH when a YAML paragraph id is not in canonical", () => {
    const s = validScript();
    const canonical = canonicalOf(s);
    s.metadata.source_fingerprint = canonical.fingerprint;
    s.source_paragraphs[0]!.id = "ch1_p1_forged0";
    expect(checkAnchor(s, canonical).errors.some((e) => e.code === "SOURCE_MISMATCH")).toBe(true);
  });
});

describe("checkAnchor (standalone, no canonical)", () => {
  it("warns SOURCE_UNVERIFIED and passes when the embedded fingerprint matches its own paragraphs", () => {
    const s = validScript();
    s.metadata.source_fingerprint = computeSourceFingerprint(s.source_paragraphs);
    const r = checkAnchor(s);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.code === "SOURCE_UNVERIFIED")).toBe(true);
  });

  it("flags SOURCE_MISMATCH when the embedded fingerprint does not match its own paragraphs", () => {
    const s = validScript();
    s.metadata.source_fingerprint = "0000000000000000";
    expect(checkAnchor(s).errors.some((e) => e.code === "SOURCE_MISMATCH")).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/core/anchor.test.ts` — expect FAIL.

- [ ] **Step 3: Implement `src/core/validate/anchor.ts`**

```ts
import type { Script } from "../schema/script-schema";
import type { ValidationItem } from "./schema-validate";
import { computeSourceFingerprint } from "../parse/fingerprint";

export interface CanonicalSource {
  paragraphIds: ReadonlyArray<string>;
  fingerprint: string;
}

export interface AnchorResult {
  errors: ValidationItem[];
  warnings: ValidationItem[];
}

function collectAllRefs(script: Script): string[] {
  const refs: string[] = [];
  script.characters.forEach((c) => refs.push(...c.source_refs));
  script.locations.forEach((l) => refs.push(...l.source_refs));
  script.adaptation_notes.forEach((n) => { if (n.source_refs) refs.push(...n.source_refs); });
  script.episodes.forEach((ep) =>
    ep.scenes.forEach((sc) => {
      refs.push(...sc.source_refs);
      sc.beats.forEach((b) => refs.push(...b.source_refs));
    }),
  );
  return refs;
}

/**
 * Anchor a YAML to its original parse (spec §4.4). With canonical info (strong): the YAML's
 * source_paragraphs and all source_refs must be subsets of canonical IDs, and
 * metadata.source_fingerprint must equal the canonical fingerprint — any deviation is
 * SOURCE_MISMATCH. Without canonical (standalone): recompute the fingerprint from the YAML's
 * own paragraphs and compare to metadata.source_fingerprint, plus a SOURCE_UNVERIFIED warning.
 */
export function checkAnchor(script: Script, canonical?: CanonicalSource): AnchorResult {
  const errors: ValidationItem[] = [];
  const warnings: ValidationItem[] = [];
  const allRefs = [...new Set(collectAllRefs(script))];

  if (canonical) {
    const canon = new Set(canonical.paragraphIds);
    script.source_paragraphs.forEach((p, i) => {
      if (!canon.has(p.id)) {
        errors.push({ path: `source_paragraphs[${i}].id`, code: "SOURCE_MISMATCH", message: `段落 ID 不在原始解析中：${p.id}` });
      }
    });
    const strayRefs = allRefs.filter((r) => !canon.has(r));
    if (strayRefs.length > 0) {
      errors.push({ path: "source_refs", code: "SOURCE_MISMATCH", message: `引用了原始解析中不存在的段落：${strayRefs.join(", ")}` });
    }
    if (script.metadata.source_fingerprint !== canonical.fingerprint) {
      errors.push({ path: "metadata.source_fingerprint", code: "SOURCE_MISMATCH", message: "source_fingerprint 与原始解析不一致" });
    }
  } else {
    warnings.push({ path: "metadata.source_fingerprint", code: "SOURCE_UNVERIFIED", message: "未提供 canonical 源，源真实性无法对照原始解析" });
    const recomputed = computeSourceFingerprint(script.source_paragraphs);
    if (script.metadata.source_fingerprint !== recomputed) {
      errors.push({ path: "metadata.source_fingerprint", code: "SOURCE_MISMATCH", message: `source_fingerprint 与自带 source_paragraphs 不一致（应为 ${recomputed}）` });
    }
  }

  return { errors, warnings };
}
```

- [ ] **Step 4: Run** `npx vitest run tests/core/anchor.test.ts` — expect PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/validate/anchor.ts tests/core/anchor.test.ts
git commit -m "feat(core): canonical anchor + fingerprint check (anti-forgery)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Short-drama constraint checks (`constraints.ts`)

**Files:** Create `src/core/validate/constraints.ts`; Test `tests/core/constraints.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/constraints.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { checkConstraints } from "../../src/core/validate/constraints";
import { validScript } from "../helpers/valid-script";

describe("checkConstraints", () => {
  it("returns no warnings for a constraint-clean script", () => {
    expect(checkConstraints(validScript())).toEqual([]);
  });

  it("warns when episode count differs from episode_count", () => {
    const s = validScript();
    s.episodes = s.episodes.slice(0, 2);
    expect(checkConstraints(s).some((w) => w.code === "CONSTRAINT_WARNING" && w.path === "episodes")).toBe(true);
  });

  it("warns when a required cliffhanger is empty", () => {
    const s = validScript();
    s.episodes[1]!.cliffhanger = "   ";
    expect(checkConstraints(s).some((w) => w.path === "episodes[1].cliffhanger")).toBe(true);
  });

  it("warns when a required opening hook is empty on the first episode", () => {
    const s = validScript();
    s.episodes[0]!.opening_hook = "";
    expect(checkConstraints(s).some((w) => w.path === "episodes[0].opening_hook")).toBe(true);
  });

  it("warns when an episode duration deviates too far from target", () => {
    const s = validScript();
    s.episodes[0]!.estimated_duration_seconds = 600; // target 120, >50% off
    expect(checkConstraints(s).some((w) => w.path === "episodes[0].estimated_duration_seconds")).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/core/constraints.test.ts` — expect FAIL.

- [ ] **Step 3: Implement `src/core/validate/constraints.ts`**

```ts
import type { Script } from "../schema/script-schema";
import type { ValidationItem } from "./schema-validate";

const DURATION_TOLERANCE = 0.5; // allow ±50% of target before warning

/**
 * Check the script against its adaptation_constraints (spec §10). Returns CONSTRAINT_WARNING
 * items; the user-edit re-validation path may upgrade these to hard CONSTRAINT_VIOLATION.
 * Checks: episode count, per-episode duration proximity, opening hook (first episode) and
 * cliffhanger (each episode) when required.
 */
export function checkConstraints(script: Script): ValidationItem[] {
  const out: ValidationItem[] = [];
  const c = script.adaptation_constraints;

  if (script.episodes.length !== c.episode_count) {
    out.push({ path: "episodes", code: "CONSTRAINT_WARNING", message: `集数 ${script.episodes.length} 与约束 episode_count=${c.episode_count} 不一致` });
  }

  script.episodes.forEach((ep, i) => {
    const target = c.target_duration_seconds_per_episode;
    if (Math.abs(ep.estimated_duration_seconds - target) > target * DURATION_TOLERANCE) {
      out.push({ path: `episodes[${i}].estimated_duration_seconds`, code: "CONSTRAINT_WARNING", message: `第 ${ep.episode_no} 集时长 ${ep.estimated_duration_seconds}s 偏离目标 ${target}s 过多` });
    }
    if (c.cliffhanger_required && ep.cliffhanger.trim() === "") {
      out.push({ path: `episodes[${i}].cliffhanger`, code: "CONSTRAINT_WARNING", message: `约束要求结尾悬念，但第 ${ep.episode_no} 集 cliffhanger 为空` });
    }
  });

  if (c.opening_hook_required) {
    const first = script.episodes[0];
    if (first && first.opening_hook.trim() === "") {
      out.push({ path: "episodes[0].opening_hook", code: "CONSTRAINT_WARNING", message: "约束要求开场钩子，但首集 opening_hook 为空" });
    }
  }

  return out;
}
```

- [ ] **Step 4: Run** `npx vitest run tests/core/constraints.test.ts` — expect PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/validate/constraints.ts tests/core/constraints.test.ts
git commit -m "feat(core): short-drama constraint checks (count/duration/hook/cliffhanger)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Quality report (`quality-report.ts`)

**Files:** Create `src/core/validate/quality-report.ts`; Test `tests/core/quality-report.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/quality-report.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { computeQualityReport } from "../../src/core/validate/quality-report";
import { validScript } from "../helpers/valid-script";

describe("computeQualityReport", () => {
  it("reports full coverage and no problems for a clean script", () => {
    const r = computeQualityReport(validScript());
    expect(r.total_paragraph_count).toBe(3);
    expect(r.referenced_paragraph_count).toBe(3);
    expect(r.source_coverage_ratio).toBe(1);
    expect(r.missing_source_refs).toEqual([]);
    expect(r.untraceable_scenes).toEqual([]);
  });

  it("ignores any embedded quality_report and recomputes", () => {
    const s = validScript();
    s.quality_report.source_coverage_ratio = 0.01;
    s.quality_report.total_paragraph_count = 999;
    const r = computeQualityReport(s);
    expect(r.source_coverage_ratio).toBe(1);
    expect(r.total_paragraph_count).toBe(3);
  });

  it("lists invalid references in missing_source_refs and lowers coverage", () => {
    const s = validScript();
    s.episodes[2]!.scenes[0]!.beats.forEach((b) => (b.source_refs = ["ch9_p9_nope"]));
    s.episodes[2]!.scenes[0]!.source_refs = ["ch9_p9_nope"];
    const r = computeQualityReport(s);
    expect(r.missing_source_refs).toContain("ch9_p9_nope");
    expect(r.referenced_paragraph_count).toBe(2); // ch1,ch2 still referenced; ch3 no longer
    expect(r.source_coverage_ratio).toBeCloseTo(2 / 3, 4);
  });

  it("marks a scene with no scene-level and no beat-level refs as untraceable", () => {
    const s = validScript();
    const sc = s.episodes[0]!.scenes[0]!;
    sc.source_refs = [];
    sc.beats.forEach((b) => (b.source_refs = []));
    const r = computeQualityReport(s);
    expect(r.untraceable_scenes).toContain("episodes[0].scenes[0]");
  });

  it("passes through repaired_refs and constraint warnings, and emits suggestions", () => {
    const r = computeQualityReport(validScript(), {
      repairedRefs: ["ch9_p9_bad"],
      constraintWarnings: [{ path: "episodes", code: "CONSTRAINT_WARNING", message: "集数不一致" }],
    });
    expect(r.repaired_refs).toEqual(["ch9_p9_bad"]);
    expect(r.constraint_warnings).toEqual([{ code: "CONSTRAINT_WARNING", message: "集数不一致" }]);
    expect(r.manual_review_suggestions).toContain("集数不一致");
  });

  it("uses canonical total when provided", () => {
    const r = computeQualityReport(validScript(), { canonicalParagraphIds: ["ch1_p1_aaaa1111", "ch2_p1_bbbb2222", "ch3_p1_cccc3333", "ch4_p1_extra"] });
    expect(r.total_paragraph_count).toBe(4);
    expect(r.source_coverage_ratio).toBeCloseTo(3 / 4, 4);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/core/quality-report.test.ts` — expect FAIL.

- [ ] **Step 3: Implement `src/core/validate/quality-report.ts`**

```ts
import type { Script } from "../schema/script-schema";
import type { ValidationItem } from "./schema-validate";

export interface QualityReportInput {
  /** Authoritative paragraph IDs from the original parse; falls back to the script's own. */
  canonicalParagraphIds?: ReadonlyArray<string>;
  /** Invalid refs the generation path auto-stripped (recorded for transparency). */
  repairedRefs?: ReadonlyArray<string>;
  /** Constraint findings (from checkConstraints) to embed + summarize. */
  constraintWarnings?: ReadonlyArray<ValidationItem>;
}

export interface QualityReport {
  source_coverage_ratio: number;
  referenced_paragraph_count: number;
  total_paragraph_count: number;
  missing_source_refs: string[];
  repaired_refs: string[];
  untraceable_scenes: string[];
  unreferenced_key_paragraphs: string[];
  constraint_warnings: { code: string; message: string }[];
  manual_review_suggestions: string[];
}

const COVERAGE_WARN_THRESHOLD = 0.5;
const KEY_PREVIEW_MIN_LEN = 20;
const MAX_KEY_PARAGRAPHS = 10;

function collectRefs(script: Script): string[] {
  const refs: string[] = [];
  script.characters.forEach((c) => refs.push(...c.source_refs));
  script.locations.forEach((l) => refs.push(...l.source_refs));
  script.adaptation_notes.forEach((n) => { if (n.source_refs) refs.push(...n.source_refs); });
  script.episodes.forEach((ep) =>
    ep.scenes.forEach((sc) => {
      refs.push(...sc.source_refs);
      sc.beats.forEach((b) => refs.push(...b.source_refs));
    }),
  );
  return refs;
}

/**
 * Compute the quality report deterministically (spec §11). Always recomputed; the script's
 * own quality_report is never read. coverage = distinct valid refs / total source paragraphs.
 */
export function computeQualityReport(script: Script, input: QualityReportInput = {}): QualityReport {
  const validIds = new Set(input.canonicalParagraphIds ?? script.source_paragraphs.map((p) => p.id));
  const total = validIds.size;

  const uniqueRefs = [...new Set(collectRefs(script))];
  const referenced = uniqueRefs.filter((r) => validIds.has(r));
  const missing = uniqueRefs.filter((r) => !validIds.has(r));
  const referencedSet = new Set(referenced);

  const untraceable: string[] = [];
  script.episodes.forEach((ep, ei) =>
    ep.scenes.forEach((sc, si) => {
      const sceneEmpty = sc.source_refs.length === 0;
      const beatsEmpty = sc.beats.every((b) => b.source_refs.length === 0);
      if (sceneEmpty && beatsEmpty) untraceable.push(`episodes[${ei}].scenes[${si}]`);
    }),
  );

  const unreferencedKey = script.source_paragraphs
    .filter((p) => !referencedSet.has(p.id) && p.text_preview.length >= KEY_PREVIEW_MIN_LEN)
    .slice(0, MAX_KEY_PARAGRAPHS)
    .map((p) => p.id);

  const coverage = total === 0 ? 0 : referenced.length / total;
  const constraintWarnings = (input.constraintWarnings ?? []).map((w) => ({ code: w.code, message: w.message }));

  const suggestions: string[] = [];
  if (coverage < COVERAGE_WARN_THRESHOLD) suggestions.push(`原文覆盖率偏低（${(coverage * 100).toFixed(0)}%），建议补充更多场景的溯源引用。`);
  if (untraceable.length > 0) suggestions.push(`有 ${untraceable.length} 个场景缺少溯源，建议补充 source_refs。`);
  if (missing.length > 0) suggestions.push(`存在 ${missing.length} 个无效引用，建议核对段落 ID。`);
  constraintWarnings.forEach((w) => suggestions.push(w.message));

  return {
    source_coverage_ratio: Number(coverage.toFixed(4)),
    referenced_paragraph_count: referenced.length,
    total_paragraph_count: total,
    missing_source_refs: missing,
    repaired_refs: [...(input.repairedRefs ?? [])],
    untraceable_scenes: untraceable,
    unreferenced_key_paragraphs: unreferencedKey,
    constraint_warnings: constraintWarnings,
    manual_review_suggestions: suggestions,
  };
}
```

- [ ] **Step 4: Run** `npx vitest run tests/core/quality-report.test.ts` — expect PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/validate/quality-report.ts tests/core/quality-report.test.ts
git commit -m "feat(core): deterministic quality report (coverage/traceability/suggestions)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: YAML conversion (`yaml/convert.ts`)

**Files:** Create `src/core/yaml/convert.ts`; Test `tests/core/yaml-convert.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/yaml-convert.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { scriptToYaml, parseScriptYaml } from "../../src/core/yaml/convert";
import { validScript } from "../helpers/valid-script";

describe("yaml convert", () => {
  it("round-trips a script (script -> yaml -> parse deep-equals)", () => {
    const s = validScript();
    const text = scriptToYaml(s);
    const r = parseScriptYaml(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual(s);
  });

  it("produces a string that contains a top-level key", () => {
    expect(scriptToYaml(validScript())).toContain("schema_version");
  });

  it("returns a YAML_SYNTAX_ERROR item (not a throw) on malformed YAML", () => {
    const r = parseScriptYaml("a: b\n  : : : oops\n - broken");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("YAML_SYNTAX_ERROR");
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/core/yaml-convert.test.ts` — expect FAIL.

- [ ] **Step 3: Implement `src/core/yaml/convert.ts`**

```ts
import { parse, stringify } from "yaml";
import type { ValidationItem } from "../validate/schema-validate";

/** Serialize a script object to YAML text. */
export function scriptToYaml(script: unknown): string {
  return stringify(script);
}

export type ParseYamlResult =
  | { ok: true; data: unknown }
  | { ok: false; error: ValidationItem };

/** Parse YAML; on a syntax error return a YAML_SYNTAX_ERROR item instead of throwing. */
export function parseScriptYaml(text: string): ParseYamlResult {
  try {
    return { ok: true, data: parse(text) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { path: "", code: "YAML_SYNTAX_ERROR", message } };
  }
}
```

- [ ] **Step 4: Run** `npx vitest run tests/core/yaml-convert.test.ts` — expect PASS (3 tests). If the malformed-YAML case actually parses (the `yaml` parser is lenient), replace the malformed input with a definitely-invalid one such as `"foo: [unclosed"` and re-run; do not weaken the round-trip or error-shape assertions.

- [ ] **Step 5: Commit**

```bash
git add src/core/yaml/convert.ts tests/core/yaml-convert.test.ts
git commit -m "feat(core): yaml conversion (stringify + safe parse)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Green gate — full suite + typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite** — `npm test`
Expected: PASS — all files. New tests: 2 (fixture) + 4 + 6 + 5 + 5 + 6 + 3 = 31, on top of 58 from Plans 1–2 ⇒ ~89 total.

- [ ] **Step 2: Type check** — `npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit (no-op if clean)**

```bash
git status --short
# If anything uncommitted: git add -A && git commit -m "test(core): green suite for validators + yaml layer" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review — Spec Coverage (Plan 3 scope)

| Spec item | Covered by |
|---|---|
| §4.4 `source_fingerprint` 计算 | Task 2 |
| §4.1 `source_refs` 存在性（INVALID_SOURCE_REF） | Task 3 |
| §4.2 `character_id`（present + dialogue beat） | Task 3 |
| §4.3 `location_id` | Task 3 |
| §4.5 `chapter_id` 引用 | Task 3 |
| §4.4 锚定（YAML ⊆ canonical、指纹一致、SOURCE_MISMATCH / SOURCE_UNVERIFIED） | Task 4 |
| §10 约束检查（集数/时长/钩子/悬念 → CONSTRAINT_WARNING） | Task 5 |
| §11 quality_report 重算（覆盖率/缺失/repaired/untraceable/建议；忽略既有） | Task 6 |
| §13 YAML 转换（stringify + 安全 parse，YAML_SYNTAX_ERROR） | Task 7 |

**Out of scope (Plan 4):** wiring these into `/api/*` routes; the generate-path auto-repair orchestration (strip invalid refs → record `repaired_refs`); upgrading `CONSTRAINT_WARNING`→`CONSTRAINT_VIOLATION` on the user-edit path; emitting `WEAK_TRACEABILITY` from `untraceable_scenes`/low coverage; the `FixtureProvider`, demo novel, UI, README.

**Type/name consistency:** all validators import `ValidationItem` from `schema-validate.ts` and `Script` from `script-schema.ts`; `computeSourceFingerprint(paragraphs)` is used by both `anchor.ts` and tests with the same `{id}[]` shape; `checkReferential`/`checkAnchor`/`checkConstraints`/`computeQualityReport`/`scriptToYaml`/`parseScriptYaml` signatures match their tests; the shared `validScript()` fixture is schema-valid (guarded by Task 1's test) and constraint-clean (so Task 5's "no warnings" baseline holds). No placeholders.
