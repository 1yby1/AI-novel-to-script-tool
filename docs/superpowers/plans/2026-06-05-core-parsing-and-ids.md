# Core Parsing & Stable-ID Layer — Implementation Plan (Plan 1 of 4, P0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic, AI-free foundation that turns raw novel text into structured chapters + paragraphs with stable IDs, and turns LLM-extracted entities into deterministically-IDed, de-duplicated entities — all fully unit-tested.

**Architecture:** Pure TypeScript functions under `src/core/parse` and `src/core/entities`, no framework and no network. Stable paragraph IDs are content+position hashes (`ch{c}_p{p}_{hash8}`); entity IDs are name-derived hashes (`{prefix}_{slug}_{hash6}`). Everything is deterministic so tests need no mocks. Implemented test-first (TDD).

**Tech Stack:** TypeScript (ESM), Vitest, Node `crypto`. (Zod / yaml / Next.js arrive in later plans.)

**Spec:** `docs/superpowers/specs/2026-06-05-novel2script-design.md` (v1.2) — this plan implements §6.1, §6.2, §7, and the `parse` half of §13.

---

## Scope & Follow-up Plans

This plan is the first of four for P0. It is self-contained and testable on its own.

- **Plan 1 (this doc):** parsing + paragraph IDs + entity normalization/IDs.
- **Plan 2:** schema & validation layer — Zod schema + profiles, `schema-validate` (beats strict / containers lenient), `referential`, `anchor`, `constraints`, `quality-report`, `yaml` convert + `fingerprint`; **+ Schema design doc `docs/script-yaml-schema.md` (D2)**.
- **Plan 3:** Next.js scaffold + `FixtureProvider` + original 3-chapter demo novel + fixtures + API routes + minimal workbench UI + README + `.env.example` + fixture integration test.
- **Plan 4 (P1):** `LiveLLMProvider` 3-stage + reliability/degradation (§9) + YAML editor with path-level errors + exports + Demo video.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | ESM project, scripts (`test`, `typecheck`) |
| `tsconfig.json` | strict TS, Bundler resolution (extensionless imports) |
| `vitest.config.ts` | test runner config |
| `src/core/parse/normalize.ts` | `normalizeText` (line cleanup) + `canonicalizeForHash` (whitespace-invariant form) |
| `src/core/parse/paragraph-id.ts` | `hash8`, `makeParagraphId` |
| `src/core/parse/chapters.ts` | parse types + `parseNovel` (chapters, paragraphs, stats, checks) |
| `src/core/entities/entity-id.ts` | `canonicalizeName`, `hash6`, `asciiSlug`, `makeEntityId` |
| `src/core/entities/normalize-entities.ts` | entity types + `normalizeEntities` (dedup + ID + catalog) |
| `tests/core/*.test.ts` | one test file per module |

---

## Task 1: Scaffold the TypeScript + Vitest project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `tests/core/sanity.test.ts`

- [ ] **Step 1: Create a feature branch**

Run:
```bash
git -C "e:/QQ下载及记录/jianli/ai-agent/aitransfer" checkout -b feat/core-parsing
```
Expected: `Switched to a new branch 'feat/core-parsing'`

- [ ] **Step 2: Initialize npm and install dev dependencies**

Run (in the project root):
```bash
npm init -y
npm install -D typescript vitest @types/node
```
Expected: `node_modules/` created, `package.json` updated. (`node_modules` is already git-ignored.)

- [ ] **Step 3: Set `package.json` to ESM and add scripts**

Replace the generated `package.json` with:
```json
{
  "name": "novel2script",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```
Then re-run `npm install -D typescript vitest @types/node` to re-populate `devDependencies` with resolved versions.

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"],
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 6: Add a sanity test** — `tests/core/sanity.test.ts`

```ts
import { describe, it, expect } from "vitest";

describe("sanity", () => {
  it("runs the test suite", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Run the suite to confirm the toolchain works**

Run: `npm test`
Expected: PASS (1 test passed).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts tests/core/sanity.test.ts
git commit -m "chore(core): scaffold TypeScript + Vitest project" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Text normalization (`normalize.ts`)

**Files:**
- Create: `src/core/parse/normalize.ts`
- Test: `tests/core/normalize.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/normalize.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { normalizeText, canonicalizeForHash } from "../../src/core/parse/normalize";

describe("normalizeText", () => {
  it("unifies CRLF/CR to LF", () => {
    expect(normalizeText("a\r\nb\rc")).toBe("a\nb\nc");
  });
  it("collapses spaces/tabs and trims each line", () => {
    expect(normalizeText("  a   b \t c  ")).toBe("a b c");
  });
  it("collapses 3+ blank lines into one blank line", () => {
    expect(normalizeText("a\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("canonicalizeForHash", () => {
  it("collapses all whitespace (incl. newlines) to single spaces and trims", () => {
    expect(canonicalizeForHash("  你好\n\n世界 ")).toBe("你好 世界");
  });
  it("is idempotent", () => {
    const once = canonicalizeForHash("a\n b ");
    expect(canonicalizeForHash(once)).toBe(once);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/normalize.test.ts`
Expected: FAIL — cannot resolve `../../src/core/parse/normalize`.

- [ ] **Step 3: Implement `src/core/parse/normalize.ts`**

```ts
// Text normalization — the foundation of stable, whitespace-invariant IDs (spec §6.1).

/**
 * Clean up a block of text without destroying its line/paragraph structure:
 *  - unify CRLF/CR -> LF
 *  - collapse runs of spaces/tabs to a single space, trim each line
 *  - collapse 3+ consecutive newlines to a single blank line
 * Chinese punctuation and content are preserved.
 */
export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Collapse ALL whitespace (including newlines and full-width spaces) to single
 * spaces, then trim. This is the canonical form hashed for stable paragraph IDs,
 * so incidental whitespace/reflow differences never change an ID.
 */
export function canonicalizeForHash(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/core/normalize.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/parse/normalize.ts tests/core/normalize.test.ts
git commit -m "feat(core): text normalization + canonical hash form" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Stable paragraph IDs (`paragraph-id.ts`)

**Files:**
- Create: `src/core/parse/paragraph-id.ts`
- Test: `tests/core/paragraph-id.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/paragraph-id.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { hash8, makeParagraphId } from "../../src/core/parse/paragraph-id";

describe("hash8", () => {
  it("returns 8 lowercase hex chars", () => {
    expect(hash8("hello")).toMatch(/^[0-9a-f]{8}$/);
  });
  it("is deterministic", () => {
    expect(hash8("林深归来")).toBe(hash8("林深归来"));
  });
  it("is whitespace-invariant (collapses runs, trims)", () => {
    expect(hash8("你好 世界")).toBe(hash8("  你好  世界  "));
  });
  it("differs for different content", () => {
    expect(hash8("甲")).not.toBe(hash8("乙"));
  });
});

describe("makeParagraphId", () => {
  it("formats as ch{c}_p{p}_{hash8}", () => {
    expect(makeParagraphId(1, 3, "林深踏上栈桥")).toMatch(/^ch1_p3_[0-9a-f]{8}$/);
  });
  it("is stable across leading/trailing whitespace", () => {
    expect(makeParagraphId(1, 3, "林深踏上栈桥")).toBe(makeParagraphId(1, 3, "  林深踏上栈桥\n"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/paragraph-id.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement `src/core/parse/paragraph-id.ts`**

```ts
import { createHash } from "node:crypto";
import { canonicalizeForHash } from "./normalize";

/** First 8 hex chars of SHA-256 over the canonicalized text (spec §6.1). */
export function hash8(text: string): string {
  return createHash("sha256").update(canonicalizeForHash(text)).digest("hex").slice(0, 8);
}

/** Stable paragraph ID: `ch{chapterNo}_p{paragraphNo}_{hash8}`. */
export function makeParagraphId(chapterNo: number, paragraphNo: number, text: string): string {
  return `ch${chapterNo}_p${paragraphNo}_${hash8(text)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/core/paragraph-id.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/parse/paragraph-id.ts tests/core/paragraph-id.test.ts
git commit -m "feat(core): stable paragraph id (ch_p_hash8)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Novel parser (`chapters.ts`)

**Files:**
- Create: `src/core/parse/chapters.ts`
- Test: `tests/core/chapters.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/chapters.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseNovel } from "../../src/core/parse/chapters";

const SAMPLE = [
  "第一章 归港",
  "",
  "林深回到了旧码头。",
  "",
  "海风很冷。",
  "",
  "第二章 重逢",
  "",
  "她在灯下等他。",
  "",
  "第三章 抉择",
  "",
  "他必须做出选择。",
].join("\n");

describe("parseNovel", () => {
  it("detects three chapters and meets the minimum", () => {
    const r = parseNovel(SAMPLE);
    expect(r.chapters.map((c) => c.index)).toEqual([1, 2, 3]);
    expect(r.checks.detected_chapter_count).toBe(3);
    expect(r.checks.meets_minimum_chapters).toBe(true);
    expect(r.checks.empty_input).toBe(false);
  });

  it("extracts the chapter title as the text after the marker", () => {
    const r = parseNovel(SAMPLE);
    expect(r.chapters[0]).toMatchObject({ id: "ch1", title: "归港", index: 1 });
  });

  it("splits paragraphs by blank lines with 1-based indices and stable ids", () => {
    const r = parseNovel(SAMPLE);
    const ch1 = r.source_paragraphs.filter((p) => p.chapter_id === "ch1");
    expect(ch1).toHaveLength(2);
    expect(ch1[0]).toMatchObject({ paragraph_index: 1, chapter_id: "ch1" });
    expect(ch1[0]!.id).toMatch(/^ch1_p1_[0-9a-f]{8}$/);
    expect(ch1[0]!.text).toBe("林深回到了旧码头。");
  });

  it("supports Chinese-numeral and English chapter markers", () => {
    const r = parseNovel("第一章\n\nA\n\nChapter 2\n\nB\n\n第三章\n\nC");
    expect(r.checks.detected_chapter_count).toBe(3);
  });

  it("produces identical ids on repeated parses (idempotent)", () => {
    const a = parseNovel(SAMPLE).source_paragraphs.map((p) => p.id);
    const b = parseNovel(SAMPLE).source_paragraphs.map((p) => p.id);
    expect(a).toEqual(b);
  });

  it("flags empty / whitespace-only input", () => {
    const r = parseNovel("   \n\n  ");
    expect(r.checks.empty_input).toBe(true);
    expect(r.chapters).toHaveLength(0);
    expect(r.checks.meets_minimum_chapters).toBe(false);
  });

  it("falls back to a single chapter when no markers are found (no content lost)", () => {
    const r = parseNovel("一段没有章节标记的散文。\n\n第二段继续。");
    expect(r.checks.detected_chapter_count).toBe(0);
    expect(r.chapters).toHaveLength(1);
    expect(r.chapters[0]!.id).toBe("ch1");
    expect(r.source_paragraphs).toHaveLength(2);
    expect(r.checks.meets_minimum_chapters).toBe(false);
  });

  it("blocks when fewer than three chapters are detected", () => {
    const r = parseNovel("第一章\n\nA\n\n第二章\n\nB");
    expect(r.checks.detected_chapter_count).toBe(2);
    expect(r.checks.meets_minimum_chapters).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/chapters.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement `src/core/parse/chapters.ts`**

```ts
import { normalizeText } from "./normalize";
import { hash8, makeParagraphId } from "./paragraph-id";

export interface SourceChapter {
  id: string;
  title: string;
  index: number;
}

export interface SourceParagraph {
  id: string;
  chapter_id: string;
  paragraph_index: number;
  /** Full paragraph text — kept in-memory for LLM stages; NOT written to YAML (spec §5.5). */
  text: string;
  text_preview: string;
  hash: string;
}

export interface ParseStats {
  chapter_count: number;
  paragraph_count: number;
  character_count: number;
}

export interface ParseChecks {
  meets_minimum_chapters: boolean;
  empty_input: boolean;
  detected_chapter_count: number;
}

export interface ParseResult {
  chapters: SourceChapter[];
  source_paragraphs: SourceParagraph[];
  stats: ParseStats;
  checks: ParseChecks;
}

const MIN_CHAPTERS = 3;
const PREVIEW_LEN = 40;

const CHAPTER_PATTERNS: RegExp[] = [
  /^第\s*[0-9]+\s*[章回节卷](.*)$/,
  /^第\s*[一二三四五六七八九十百千零〇两]+\s*[章回节卷](.*)$/,
  /^Chapter\s+\d+\b(.*)$/i,
];

function matchChapterHeading(line: string): { title: string } | null {
  const t = line.trim();
  for (const re of CHAPTER_PATTERNS) {
    const m = re.exec(t);
    if (m) return { title: (m[1] ?? "").trim() };
  }
  return null;
}

export function parseNovel(rawText: string): ParseResult {
  const text = normalizeText(rawText ?? "");
  const emptyInput = text.length === 0;
  const lines = text.length === 0 ? [] : text.split("\n");

  // 1. Locate chapter headings.
  const headings: { lineIndex: number; title: string }[] = [];
  lines.forEach((line, i) => {
    const h = matchChapterHeading(line);
    if (h) headings.push({ lineIndex: i, title: h.title });
  });
  const detectedChapterCount = headings.length;

  // 2. Slice into raw chapter blocks; 0 headings -> single fallback chapter.
  type RawChapter = { title: string; body: string };
  let rawChapters: RawChapter[];
  if (detectedChapterCount === 0) {
    rawChapters = emptyInput ? [] : [{ title: "未命名章节", body: text }];
  } else {
    rawChapters = headings.map((h, idx) => {
      const start = h.lineIndex + 1;
      const end = idx + 1 < headings.length ? headings[idx + 1]!.lineIndex : lines.length;
      return { title: h.title, body: lines.slice(start, end).join("\n").trim() };
    });
  }

  // 3. Build chapters + paragraphs with stable IDs.
  const chapters: SourceChapter[] = [];
  const source_paragraphs: SourceParagraph[] = [];
  rawChapters.forEach((rc, ci) => {
    const chapterNo = ci + 1;
    const chapterId = `ch${chapterNo}`;
    chapters.push({ id: chapterId, title: rc.title || `第${chapterNo}章`, index: chapterNo });

    const paras = rc.body.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
    paras.forEach((p, pi) => {
      const paragraphNo = pi + 1;
      source_paragraphs.push({
        id: makeParagraphId(chapterNo, paragraphNo, p),
        chapter_id: chapterId,
        paragraph_index: paragraphNo,
        text: p,
        text_preview: p.length > PREVIEW_LEN ? p.slice(0, PREVIEW_LEN) + "…" : p,
        hash: hash8(p),
      });
    });
  });

  return {
    chapters,
    source_paragraphs,
    stats: {
      chapter_count: chapters.length,
      paragraph_count: source_paragraphs.length,
      character_count: text.length,
    },
    checks: {
      meets_minimum_chapters: detectedChapterCount >= MIN_CHAPTERS,
      empty_input: emptyInput,
      detected_chapter_count: detectedChapterCount,
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/core/chapters.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/parse/chapters.ts tests/core/chapters.test.ts
git commit -m "feat(core): novel parser — chapters, paragraphs, checks, fallbacks" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Deterministic entity IDs (`entity-id.ts`)

**Files:**
- Create: `src/core/entities/entity-id.ts`
- Test: `tests/core/entity-id.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/entity-id.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { makeEntityId, canonicalizeName, asciiSlug } from "../../src/core/entities/entity-id";

describe("canonicalizeName", () => {
  it("removes whitespace and lowercases", () => {
    expect(canonicalizeName("  Old   Dock ")).toBe("olddock");
  });
});

describe("asciiSlug", () => {
  it("keeps lowercase alphanumerics only", () => {
    expect(asciiSlug("Lin Shen")).toBe("linshen");
  });
  it("is empty for purely non-ASCII names", () => {
    expect(asciiSlug("林深")).toBe("");
  });
});

describe("makeEntityId", () => {
  it("is deterministic for the same name", () => {
    expect(makeEntityId("char", "林深")).toBe(makeEntityId("char", "林深"));
  });
  it("omits the slug for non-ASCII names", () => {
    expect(makeEntityId("char", "林深")).toMatch(/^char_[0-9a-f]{6}$/);
  });
  it("includes an ASCII slug when available", () => {
    expect(makeEntityId("char", "Lin Shen")).toMatch(/^char_linshen_[0-9a-f]{6}$/);
  });
  it("is invariant to case/whitespace in the name", () => {
    expect(makeEntityId("loc", "Old Dock")).toBe(makeEntityId("loc", "  old   dock "));
  });
  it("differs for different names", () => {
    expect(makeEntityId("char", "林深")).not.toBe(makeEntityId("char", "苏晚"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/entity-id.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement `src/core/entities/entity-id.ts`**

```ts
import { createHash } from "node:crypto";

/** Canonical form for hashing/dedup: drop all whitespace, lowercase (spec §6.2). */
export function canonicalizeName(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

/** First 6 hex chars of SHA-256 — the uniqueness/determinism guarantee for entity IDs. */
export function hash6(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 6);
}

/** Optional readable prefix: lowercase ASCII alphanumerics only (empty for Chinese names). */
export function asciiSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16);
}

/**
 * Deterministic entity ID `${prefix}_${slug}_${hash6}` (slug omitted when empty).
 * hash6 is over the canonical name, so the same name always yields the same ID.
 */
export function makeEntityId(prefix: "char" | "loc", name: string): string {
  const h = hash6(canonicalizeName(name));
  const slug = asciiSlug(name);
  return slug ? `${prefix}_${slug}_${h}` : `${prefix}_${h}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/core/entity-id.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/entities/entity-id.ts tests/core/entity-id.test.ts
git commit -m "feat(core): deterministic entity ids (name-derived hash)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Entity normalization (`normalize-entities.ts`)

**Files:**
- Create: `src/core/entities/normalize-entities.ts`
- Test: `tests/core/normalize-entities.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/core/normalize-entities.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { normalizeEntities } from "../../src/core/entities/normalize-entities";

describe("normalizeEntities", () => {
  it("assigns deterministic ids and builds a parallel catalog", () => {
    const r = normalizeEntities("char", [{ name: "林深" }, { name: "苏晚" }]);
    expect(r.entities).toHaveLength(2);
    expect(r.catalog).toEqual(r.entities.map((e) => ({ id: e.id, name: e.name })));
    expect(r.entities[0]!.id).toMatch(/^char_[0-9a-f]{6}$/);
  });

  it("merges duplicates that share a name, keeping prior attributes", () => {
    const r = normalizeEntities("char", [
      { name: "林深", motivation: "复仇" },
      { name: "林深", aliases: ["老林"] },
    ]);
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0]!.aliases).toContain("老林");
    expect(r.entities[0]!.motivation).toBe("复仇");
  });

  it("merges when a later entity's alias matches an earlier name", () => {
    const r = normalizeEntities("char", [{ name: "林深" }, { name: "林队长", aliases: ["林深"] }]);
    expect(r.entities).toHaveLength(1);
  });

  it("maps both names and aliases to the assigned id", () => {
    const r = normalizeEntities("char", [{ name: "林深", aliases: ["老林"] }]);
    const id = r.entities[0]!.id;
    expect(r.nameToId["林深"]).toBe(id);
    expect(r.nameToId["老林"]).toBe(id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/normalize-entities.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement `src/core/entities/normalize-entities.ts`**

```ts
import { makeEntityId, canonicalizeName } from "./entity-id";

/** Raw entity as extracted by the LLM (no system ID yet). Extra attrs are carried through. */
export interface RawEntity {
  name: string;
  aliases?: string[];
  [key: string]: unknown;
}

export interface NormalizedEntity {
  id: string;
  name: string;
  aliases: string[];
  [key: string]: unknown;
}

export interface EntityNormalizationResult {
  entities: NormalizedEntity[];
  /** canonical name/alias -> assigned id (for remapping references downstream) */
  nameToId: Record<string, string>;
  /** legal id + display name list, injected into plan/generate prompts (anti-hallucination) */
  catalog: { id: string; name: string }[];
}

/**
 * Dedup entities by canonical name (or any alias), assign deterministic IDs, and
 * produce the legal-ID catalog. The LLM proposes names/attrs; the system owns IDs (spec §6.2).
 */
export function normalizeEntities(prefix: "char" | "loc", raw: RawEntity[]): EntityNormalizationResult {
  const idByCanon = new Map<string, string>();      // canonical name/alias -> id
  const canonById = new Map<string, string>();      // id -> primary canonical name (collision check)
  const entityById = new Map<string, NormalizedEntity>();

  for (const e of raw) {
    const canon = canonicalizeName(e.name);
    const aliasCanons = (e.aliases ?? []).map(canonicalizeName);

    // 1. Find an existing id by name or any alias.
    let id = idByCanon.get(canon);
    if (!id) {
      for (const a of aliasCanons) {
        const found = idByCanon.get(a);
        if (found) { id = found; break; }
      }
    }

    // 2. Allocate a new id, disambiguating the rare hash collision.
    if (!id) {
      const base = makeEntityId(prefix, e.name);
      id = base;
      let n = 2;
      while (canonById.has(id) && canonById.get(id) !== canon) {
        id = `${base}_${n++}`;
      }
      canonById.set(id, canon);
    }

    // 3. Register name + aliases -> id.
    idByCanon.set(canon, id);
    for (const a of aliasCanons) idByCanon.set(a, id);

    // 4. Insert or merge the entity.
    const prev = entityById.get(id);
    if (prev) {
      entityById.set(id, {
        ...prev,
        ...e,
        id,
        name: prev.name,
        aliases: Array.from(new Set([...prev.aliases, ...(e.aliases ?? [])])),
      });
    } else {
      entityById.set(id, { ...e, id, name: e.name, aliases: e.aliases ?? [] });
    }
  }

  const entities = [...entityById.values()];
  return {
    entities,
    nameToId: Object.fromEntries(idByCanon),
    catalog: entities.map((e) => ({ id: e.id, name: e.name })),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/core/normalize-entities.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/entities/normalize-entities.ts tests/core/normalize-entities.test.ts
git commit -m "feat(core): entity normalization (dedup + id + catalog)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Green gate — full suite + typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all files (`sanity`, `normalize`, `paragraph-id`, `chapters`, `entity-id`, `normalize-entities`), 32 tests total.

- [ ] **Step 2: Run the type checker**

Run: `npm run typecheck`
Expected: no errors, exit 0.

- [ ] **Step 3: Commit any remaining changes (if the prior steps were already committed, this is a no-op)**

```bash
git status --short
# If nothing to commit, skip. Otherwise:
git add -A
git commit -m "test(core): full green suite + typecheck for parsing/ID layer" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review — Spec Coverage (Plan 1 scope)

| Spec item | Covered by |
|---|---|
| §6.1 段落 ID 格式 + 规范化 + 幂等/空白不变 | Tasks 2, 3 |
| §6.2 实体确定性 ID + 归一化去重 + catalog | Tasks 5, 6 |
| §7 章节标题识别（数字/中文/英文） | Task 4 |
| §7 段落切分（空行、1-based） | Task 4 |
| §7 空输入 / 0 章 fallback 单章（段落不丢） | Task 4 |
| §7 <3 章拦截 (`meets_minimum_chapters:false`) | Task 4 |
| §13 `parse` 输出 `chapters/source_paragraphs/stats/checks` | Task 4 |
| 验收 2（重复解析同 ID）/ 3（空白差异不影响 ID） | Tasks 3, 4 |
| 验收 16（空输入信号）/ 17（0 章回退仍拦截） | Task 4 |

Out of scope for Plan 1 (handled in later plans): `source_fingerprint` (Plan 2, alongside YAML/convert), Zod schema & all validators, YAML conversion, fixture provider, API routes, UI, Schema design doc.

**Type consistency check:** `ParseResult`/`SourceParagraph`/`SourceChapter` are defined once in `chapters.ts` and referenced nowhere conflicting; `makeEntityId(prefix, name)` and `makeParagraphId(chapterNo, paragraphNo, text)` signatures are used consistently in tests and impl; `normalizeEntities(prefix, raw)` return shape (`entities`/`nameToId`/`catalog`) matches its tests. No placeholders.
