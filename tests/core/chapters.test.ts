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

  it("preserves content before the first chapter heading as a leading 前言 chapter", () => {
    const r = parseNovel("楔子：很久以前的一个夜晚。\n\n第一章\n\nA\n\n第二章\n\nB\n\n第三章\n\nC");
    // detected markers unchanged -> still meets the 3-chapter minimum
    expect(r.checks.detected_chapter_count).toBe(3);
    expect(r.checks.meets_minimum_chapters).toBe(true);
    // preface preserved (no content lost), as a leading chapter titled 前言
    expect(r.chapters[0]!.title).toBe("前言");
    const prefaceParas = r.source_paragraphs.filter((p) => p.chapter_id === "ch1");
    expect(prefaceParas[0]!.text).toContain("楔子");
  });

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

  it("returns an empty warnings array for a clean multi-chapter parse", () => {
    const r = parseNovel(SAMPLE);
    expect(r.warnings).toEqual([]);
  });
});
