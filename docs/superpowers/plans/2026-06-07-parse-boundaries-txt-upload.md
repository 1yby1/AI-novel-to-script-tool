# Parse Boundaries & TXT Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strengthen the first-mile input layer so uploaded or pasted novels are split into chapters/paragraphs conservatively, with visible parse diagnostics, before analysis/planning/generation consumes them.

**Architecture:** Keep the pipeline contract unchanged: UI text input -> `/api/parse` -> `parseNovel` -> existing analysis/plan/generate APIs. Extend the parser result with backward-compatible `warnings`, improve heading detection and paragraph chunking inside `src/core/parse/chapters.ts`, and add a lightweight browser-side `.txt` upload control in `src/app/page.tsx`.

**Tech Stack:** TypeScript strict mode, Next.js App Router, existing React workbench UI, existing parser utilities, Vitest.

---

## Scope

Implement only:

- Conservative chapter-heading boundary detection for common Chinese/English TXT formats.
- Parser diagnostics exposed as `ParseResult.warnings`.
- Long paragraph chunking so downstream LLM prompts do not receive huge unsplittable paragraphs.
- TXT upload in the workbench, feeding the existing source textarea and parse flow.
- Focused parser tests and a manual UI smoke checklist.

Do not implement:

- DOCX/PDF/EPUB upload.
- Server-side file upload endpoints.
- GBK/ANSI decoding.
- Long-novel chunked generation.
- YAML schema changes.
- Storyboard or video prompt pack.

## Current Situation

Current parser behavior:

1. `parseNovel` normalizes text.
2. It detects only:
   - `第1章`
   - `第一章`
   - `Chapter 1`
3. Content before the first detected heading is preserved as `前言`.
4. Paragraphs split only on blank lines.
5. The parse response has no user-visible warning list.

Current UI behavior:

1. User can paste text or load the built-in demo.
2. There is no file picker.
3. Editing source text clears parsed/downstream state.
4. Parse results show metrics and paragraph rows, but no parser warnings.

Problems:

- TXT novels often use headings like `第01章：归港`, `1、归港`, `一、归港`, or `CHAPTER 02 - Return`.
- A naive regex expansion can misread numbered prose like `1、他走进房间……` as a chapter heading.
- Long web-novel paragraphs can exceed useful LLM context granularity and weaken traceability.
- Uploading `.txt` should feel like a first-class input path, because many interview/demo users will not paste large text manually.

---

## File Map

Modify:

- `src/core/parse/chapters.ts`  
  Add heading guards, title cleanup, warning types, long paragraph chunking.

- `tests/core/chapters.test.ts`  
  Add boundary tests before implementation and keep existing tests passing.

- `src/app/page.tsx`  
  Add TXT upload button/input, parse warnings type, warning display.

- `README.md`  
  Briefly document TXT upload and parser warnings in the existing usage section.

No changes expected:

- `src/app/api/parse/route.ts`  
  It already spreads `parseNovel` output into JSON, so `warnings` should pass through automatically.

- `src/core/schema/*`
- `src/core/validate/*`
- `src/llm/*`

---

## Implementation Tasks

### Task 1: Add Parser Boundary Tests First

- [ ] Add tests for padded Arabic chapter markers and punctuation cleanup.
- [ ] Add tests for short numbered headings.
- [ ] Add tests that numbered prose is not treated as a heading.
- [ ] Add tests for long paragraph splitting and warning emission.
- [ ] Add tests that parser warnings are stable and non-fatal.

Add these cases to `tests/core/chapters.test.ts`:

```ts
it("detects padded chapter markers and cleans title punctuation", () => {
  const r = parseNovel("第01章：归港\n\nA\n\n第002章 - 重逢\n\nB\n\n第三章、抉择\n\nC");

  expect(r.checks.detected_chapter_count).toBe(3);
  expect(r.chapters.map((c) => c.title)).toEqual(["归港", "重逢", "抉择"]);
  expect(r.checks.meets_minimum_chapters).toBe(true);
});

it("detects short numbered TXT headings", () => {
  const r = parseNovel("1、归港\n\nA\n\n二、重逢\n\nB\n\n3. 抉择\n\nC");

  expect(r.checks.detected_chapter_count).toBe(3);
  expect(r.chapters.map((c) => c.title)).toEqual(["归港", "重逢", "抉择"]);
});

it("does not mistake numbered prose for chapter headings", () => {
  const text = [
    "第一章",
    "",
    "1、这不是章节标题，而是一段很长的叙述，林深继续向前走，他没有停下。",
    "",
    "第二章",
    "",
    "B",
    "",
    "第三章",
    "",
    "C",
  ].join("\n");

  const r = parseNovel(text);

  expect(r.checks.detected_chapter_count).toBe(3);
  expect(r.chapters).toHaveLength(3);
  expect(r.source_paragraphs.some((p) => p.text.startsWith("1、这不是章节标题"))).toBe(true);
});

it("splits very long paragraphs and reports a parser warning", () => {
  const long = Array.from({ length: 260 }, (_, i) => `句子${i}。`).join("");
  const r = parseNovel(`第一章\n\n${long}\n\n第二章\n\nB\n\n第三章\n\nC`);

  const ch1 = r.source_paragraphs.filter((p) => p.chapter_id === "ch1");
  expect(ch1.length).toBeGreaterThan(1);
  expect(ch1.every((p) => p.text.length <= 760)).toBe(true);
  expect(r.warnings.some((w) => w.code === "LONG_PARAGRAPH_SPLIT")).toBe(true);
});

it("reports non-fatal warnings for fallback and chapter-count issues", () => {
  const r = parseNovel("没有章节标记的正文。\n\n第二段。");

  expect(r.chapters).toHaveLength(1);
  expect(r.checks.meets_minimum_chapters).toBe(false);
  expect(r.warnings.map((w) => w.code)).toContain("FALLBACK_SINGLE_CHAPTER");
  expect(r.warnings.map((w) => w.code)).toContain("FEW_CHAPTERS");
});
```

Run the focused test before implementation to confirm it fails for the intended reasons:

```powershell
npm test -- tests/core/chapters.test.ts
```

### Task 2: Extend Parser Result With Warnings

- [ ] Add warning types in `src/core/parse/chapters.ts`.
- [ ] Return `warnings: []` for successful clean parses.
- [ ] Preserve existing fields and existing API shape.
- [ ] Make warnings informational; they must not block parse output.

Add near the existing parser interfaces:

```ts
export type ParseWarningCode =
  | "PREFACE_PRESERVED"
  | "FALLBACK_SINGLE_CHAPTER"
  | "FEW_CHAPTERS"
  | "EMPTY_CHAPTER"
  | "LONG_PARAGRAPH_SPLIT";

export interface ParseWarning {
  code: ParseWarningCode;
  message: string;
  path?: string;
}

export interface ParseResult {
  chapters: SourceChapter[];
  source_paragraphs: SourceParagraph[];
  stats: ParseStats;
  checks: ParseChecks;
  warnings: ParseWarning[];
}
```

Warning rules:

- `PREFACE_PRESERVED`: content exists before the first heading and was kept as `前言`.
- `FALLBACK_SINGLE_CHAPTER`: no headings detected, non-empty input kept as `未命名章节`.
- `FEW_CHAPTERS`: non-empty input has fewer than `MIN_CHAPTERS` detected headings.
- `EMPTY_CHAPTER`: a detected chapter block has no paragraphs.
- `LONG_PARAGRAPH_SPLIT`: at least one paragraph was chunked by the long-paragraph guard.

Keep messages short and user-facing:

```ts
warnings.push({
  code: "FEW_CHAPTERS",
  message: `仅识别到 ${detectedChapterCount} 个章节，至少需要 ${MIN_CHAPTERS} 章才能继续生成。`,
});
```

### Task 3: Make Heading Detection Broader But Conservative

- [ ] Support padded/full-width Arabic numbers.
- [ ] Clean leading separators from titles.
- [ ] Support short numbered TXT headings.
- [ ] Guard numbered-heading patterns by line length and sentence-ending punctuation.
- [ ] Keep `序章/楔子` before the first real heading as the existing `前言` behavior, not as counted chapters.

Use constants and helpers similar to:

```ts
const MIN_CHAPTERS = 3;
const PREVIEW_LEN = 40;
const SHORT_HEADING_MAX_LEN = 48;
const TITLE_SEPARATOR_RE = /^[\s:：\-—、.．]+/;
const SENTENCE_ENDING_RE = /[。！？!?]$/;

const CHAPTER_PATTERNS: RegExp[] = [
  /^第\s*[0-9０-９]+\s*[章回节卷]\s*(.*)$/,
  /^第\s*[一二三四五六七八九十百千零〇两]+\s*[章回节卷]\s*(.*)$/,
  /^Chapter\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b\s*(.*)$/i,
  /^[0-9０-９]+[、.．]\s*(.+)$/,
  /^[一二三四五六七八九十百千零〇两]+[、.．]\s*(.+)$/,
];

function cleanupTitle(raw: string): string {
  return raw.replace(TITLE_SEPARATOR_RE, "").trim();
}

function canBeHeadingLine(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.length <= SHORT_HEADING_MAX_LEN && !SENTENCE_ENDING_RE.test(t);
}

function matchChapterHeading(line: string): { title: string } | null {
  const t = line.trim();
  if (!canBeHeadingLine(t)) return null;

  for (const re of CHAPTER_PATTERNS) {
    const m = re.exec(t);
    if (m) return { title: cleanupTitle(m[1] ?? "") };
  }
  return null;
}
```

Design rationale:

- The line-length guard is the main false-positive control for `1、正文……`.
- The sentence-ending guard protects common numbered paragraphs in prose.
- The regex set intentionally avoids generic `序章/楔子/尾声` counting in this pass because those terms often appear as preface prose or section labels. Existing preface preservation already keeps the text.
- Empty titles remain allowed; chapter creation already falls back to `第${chapterNo}章`.

### Task 4: Add Long Paragraph Chunking

- [ ] Replace direct `rc.body.split(/\n{2,}/)` with a helper.
- [ ] Split first by blank lines.
- [ ] If a paragraph exceeds `MAX_PARAGRAPH_CHARS`, split on sentence boundaries where possible.
- [ ] Use hard slicing only when a single sentence is still too long.
- [ ] Emit one warning per affected source chapter, not one warning per chunk.

Implementation shape:

```ts
const MAX_PARAGRAPH_CHARS = 700;

function splitBaseParagraphs(body: string): string[] {
  return body.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
}

function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= MAX_PARAGRAPH_CHARS) return [paragraph];

  const sentences = paragraph.match(/[^。！？!?；;]+[。！？!?；;]?/g) ?? [paragraph];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = `${current}${sentence}`.trim();
    if (next.length <= MAX_PARAGRAPH_CHARS) {
      current = next;
      continue;
    }

    if (current.length > 0) chunks.push(current);

    if (sentence.length > MAX_PARAGRAPH_CHARS) {
      for (let i = 0; i < sentence.length; i += MAX_PARAGRAPH_CHARS) {
        chunks.push(sentence.slice(i, i + MAX_PARAGRAPH_CHARS).trim());
      }
      current = "";
    } else {
      current = sentence.trim();
    }
  }

  if (current.length > 0) chunks.push(current);
  return chunks.filter((chunk) => chunk.length > 0);
}

function splitParagraphs(body: string): { paragraphs: string[]; splitCount: number } {
  let splitCount = 0;
  const paragraphs = splitBaseParagraphs(body).flatMap((paragraph) => {
    const chunks = splitLongParagraph(paragraph);
    if (chunks.length > 1) splitCount += 1;
    return chunks;
  });
  return { paragraphs, splitCount };
}
```

Use it in chapter construction:

```ts
const { paragraphs: paras, splitCount } = splitParagraphs(rc.body);
if (splitCount > 0) {
  warnings.push({
    code: "LONG_PARAGRAPH_SPLIT",
    path: `chapters[${ci}]`,
    message: `第${chapterNo}章存在过长段落，已按句子边界拆分为更适合追溯的段落。`,
  });
}
if (paras.length === 0 && rc.body.length === 0) {
  warnings.push({
    code: "EMPTY_CHAPTER",
    path: `chapters[${ci}]`,
    message: `第${chapterNo}章没有可解析正文。`,
  });
}
```

ID impact:

- Existing normal paragraphs keep their stable IDs.
- Only overlong paragraphs receive additional paragraph indices and new IDs.
- This is acceptable because downstream traceability should prefer smaller reference units.

### Task 5: Add TXT Upload To Workbench

- [ ] Import `useRef` and `Upload`.
- [ ] Add a hidden file input with `accept=".txt,text/plain"`.
- [ ] Add an `上传 TXT` button in the existing source control flow.
- [ ] Read the file as UTF-8 text through browser `File.text()`.
- [ ] Strip UTF-8 BOM.
- [ ] Reject non-TXT files and files above a small demo-safe limit.
- [ ] On successful load, set textarea content, clear parse/downstream state, and show a message.

Use constants near existing helper functions:

```ts
const MAX_TXT_BYTES = 1024 * 1024;
```

Update imports:

```ts
import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Gauge,
  GitBranch,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  SearchCheck,
  Upload,
  Wand2,
} from "lucide-react";
```

Inside `WorkbenchPage`:

```ts
const txtInputRef = useRef<HTMLInputElement | null>(null);
```

Add the handler:

```ts
async function loadTxtFile(file: File | null) {
  if (!file) return;

  const isTxt = file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt");
  if (!isTxt) {
    setMessage({ type: "error", text: "请上传 .txt 文本文件。" });
    return;
  }

  if (file.size > MAX_TXT_BYTES) {
    setMessage({ type: "error", text: "TXT 文件超过 1MB，请先截取 3 章左右文本再上传。" });
    return;
  }

  try {
    const text = (await file.text()).replace(/^\uFEFF/, "");
    setNovelText(text);
    setParseResult(null);
    resetDownstream();
    setMessage({ type: "info", text: `已载入 TXT：${file.name}` });
  } catch (error) {
    setMessage({ type: "error", text: error instanceof Error ? error.message : "TXT 读取失败。" });
  }
}
```

Add input/button near the existing source controls:

```tsx
<input
  ref={txtInputRef}
  type="file"
  accept=".txt,text/plain"
  hidden
  onChange={(event) => {
    void loadTxtFile(event.target.files?.[0] ?? null);
    event.currentTarget.value = "";
  }}
/>
<button className="btn" disabled={isBusy} onClick={() => txtInputRef.current?.click()}>
  <Upload size={15} />
  上传 TXT
</button>
```

Place the upload button next to `载入 Demo`, before `解析`. The existing `.flow` grid can handle the extra button.

Decoding note:

- Do not add GBK/ANSI decoding in this pass.
- If a Windows TXT shows garbled text, the intended guidance is: save as UTF-8 and upload again.
- This keeps the feature dependency-free and enough for the interview project.

### Task 6: Surface Parse Warnings In The UI

- [ ] Extend the local `ParseResult` interface in `src/app/page.tsx`.
- [ ] Render warnings below parse metrics and above paragraph rows.
- [ ] Reuse existing `.findings`, `.finding`, and `.finding.warning` styles.
- [ ] Keep warnings visible but non-blocking.

Add UI type:

```ts
interface ParseWarning {
  code: string;
  message: string;
  path?: string;
}

interface ParseResult {
  chapters: SourceChapter[];
  source_paragraphs: SourceParagraph[];
  source_fingerprint: string;
  mode: "live" | "fixture";
  stats: {
    chapter_count: number;
    paragraph_count: number;
    character_count: number;
  };
  checks: {
    meets_minimum_chapters: boolean;
    empty_input: boolean;
    detected_chapter_count: number;
  };
  warnings: ParseWarning[];
}
```

Render after the metric grid:

```tsx
{parseResult.warnings.length > 0 ? (
  <div className="findings" style={{ marginTop: 10 }}>
    {parseResult.warnings.map((warning, index) => (
      <div className="finding warning" key={`${warning.code}-${warning.path ?? index}`}>
        <strong>{warning.code}</strong>
        <span>{warning.message}</span>
      </div>
    ))}
  </div>
) : null}
```

Also update the parse success message to mention warnings:

```ts
const warningSuffix = data.warnings.length > 0 ? `，${data.warnings.length} 条提示` : "";
text: data.checks.meets_minimum_chapters
  ? `解析完成：${data.stats.chapter_count} 章 / ${data.stats.paragraph_count} 段${warningSuffix}`
  : ...
```

### Task 7: Update README Briefly

- [ ] In the usage/workbench section, mention users can paste text or upload UTF-8 `.txt`.
- [ ] Mention parser warnings are non-blocking diagnostics.
- [ ] Keep the README addition short.

Suggested wording:

```md
- Input: paste 3+ chapters of novel text or upload a UTF-8 `.txt` file in the workbench.
- Parser diagnostics: the parse step now surfaces non-blocking warnings such as preserved preface text, fewer-than-required chapters, empty chapters, and long paragraphs split for better traceability.
```

---

## Verification

Run:

```powershell
npm test -- tests/core/chapters.test.ts
npm test
npm run typecheck
npm run build
```

Manual smoke:

1. Start the app.
2. Upload a small UTF-8 `.txt` with 3 chapters.
3. Confirm textarea is populated and downstream state is cleared.
4. Click `解析`.
5. Confirm chapter/paragraph counts render.
6. Confirm warnings render for fallback/few chapters/long paragraphs when using those inputs.
7. Confirm `分析 -> 规划 -> 生成 -> 校验` still works for the built-in demo.

Acceptance criteria:

- Existing parser tests still pass.
- New parser boundary tests pass.
- Parser never drops preface or fallback text.
- Numbered prose is preserved as paragraph text, not split into a chapter.
- Overlong paragraphs are split into smaller traceable units and warn the user.
- TXT upload requires no new server endpoint and uses the same parse pipeline as pasted text.
- Typecheck and production build pass.
