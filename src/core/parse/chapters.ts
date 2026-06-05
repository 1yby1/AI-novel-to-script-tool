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
    rawChapters = [];
    // Preserve any non-empty content before the first heading as a leading chapter
    // (no source text is silently dropped). It does not count toward detected_chapter_count.
    const prefaceBody = lines.slice(0, headings[0]!.lineIndex).join("\n").trim();
    if (prefaceBody.length > 0) rawChapters.push({ title: "前言", body: prefaceBody });
    headings.forEach((h, idx) => {
      const start = h.lineIndex + 1;
      const end = idx + 1 < headings.length ? headings[idx + 1]!.lineIndex : lines.length;
      rawChapters.push({ title: h.title, body: lines.slice(start, end).join("\n").trim() });
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
