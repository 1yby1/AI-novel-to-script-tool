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
