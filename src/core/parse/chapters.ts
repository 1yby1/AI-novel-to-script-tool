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
  /** Non-blocking diagnostics (preface kept, fallback single chapter, few/empty chapters, long-paragraph splits). */
  warnings: ParseWarning[];
}

const MIN_CHAPTERS = 3;
const PREVIEW_LEN = 40;
const SHORT_HEADING_MAX_LEN = 48;
const MAX_PARAGRAPH_CHARS = 700;

const TITLE_SEPARATOR_RE = /^[\s:：\-—、.．]+/;
const SENTENCE_ENDING_RE = /[。！？!?]$/;

const CHAPTER_PATTERNS: RegExp[] = [
  /^第\s*[0-9０-９]+\s*[章回节卷]\s*(.*)$/,
  /^第\s*[一二三四五六七八九十百千零〇两]+\s*[章回节卷]\s*(.*)$/,
  /^Chapter\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b\s*(.*)$/i,
  /^[0-9０-９]+(?:、|[.．](?!\d))\s*(.+)$/,
  /^[一二三四五六七八九十百千零〇两]+(?:、|[.．](?!\d))\s*(.+)$/,
];

function cleanupTitle(raw: string): string {
  return raw.replace(TITLE_SEPARATOR_RE, "").trim();
}

/**
 * False-positive guard for the broadened heading patterns: a heading line is short and does
 * not end with sentence punctuation, so numbered prose like "1、他走进房间……。" is not treated
 * as a chapter heading.
 */
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

function splitBaseParagraphs(body: string): string[] {
  return body.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Split an overlong paragraph on sentence boundaries; hard-slice only a single oversized sentence. */
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

export function parseNovel(rawText: string): ParseResult {
  const text = normalizeText(rawText ?? "");
  const emptyInput = text.length === 0;
  const lines = text.length === 0 ? [] : text.split("\n");
  const warnings: ParseWarning[] = [];

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
    if (!emptyInput) {
      warnings.push({ code: "FALLBACK_SINGLE_CHAPTER", message: "未检测到章节标记，已按单章解析；请用「第X章」等标记分章。" });
    }
  } else {
    rawChapters = [];
    // Preserve any non-empty content before the first heading as a leading chapter
    // (no source text is silently dropped). It does not count toward detected_chapter_count.
    const prefaceBody = lines.slice(0, headings[0]!.lineIndex).join("\n").trim();
    if (prefaceBody.length > 0) {
      rawChapters.push({ title: "前言", body: prefaceBody });
      warnings.push({ code: "PREFACE_PRESERVED", message: "首个章节标记前的内容已保留为「前言」。" });
    }
    headings.forEach((h, idx) => {
      const start = h.lineIndex + 1;
      const end = idx + 1 < headings.length ? headings[idx + 1]!.lineIndex : lines.length;
      rawChapters.push({ title: h.title, body: lines.slice(start, end).join("\n").trim() });
    });
  }

  if (!emptyInput && detectedChapterCount < MIN_CHAPTERS) {
    warnings.push({ code: "FEW_CHAPTERS", message: `仅识别到 ${detectedChapterCount} 个章节，至少需要 ${MIN_CHAPTERS} 章才能继续生成。` });
  }

  // 3. Build chapters + paragraphs with stable IDs.
  const chapters: SourceChapter[] = [];
  const source_paragraphs: SourceParagraph[] = [];
  rawChapters.forEach((rc, ci) => {
    const chapterNo = ci + 1;
    const chapterId = `ch${chapterNo}`;
    chapters.push({ id: chapterId, title: rc.title || `第${chapterNo}章`, index: chapterNo });

    const { paragraphs: paras, splitCount } = splitParagraphs(rc.body);
    if (splitCount > 0) {
      warnings.push({ code: "LONG_PARAGRAPH_SPLIT", path: `chapters[${ci}]`, message: `第${chapterNo}章存在过长段落，已按句子边界拆分为更易追溯的段落。` });
    }
    if (paras.length === 0) {
      warnings.push({ code: "EMPTY_CHAPTER", path: `chapters[${ci}]`, message: `第${chapterNo}章没有可解析正文。` });
    }
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
    warnings,
  };
}
