import { NextResponse } from "next/server";
import { parseNovel } from "../../../core/parse/chapters";
import { computeSourceFingerprint } from "../../../core/parse/fingerprint";
import { selectScriptProvider } from "../../../llm/get-provider";
import type { AnalyzeResult } from "../../../llm/provider";
import { jsonError, readJsonBody, stringField } from "../_lib/http";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await readJsonBody(request);
  if (!body) return jsonError("BAD_REQUEST", "请求体必须是 JSON 对象。");

  const text = stringField(body, "text");
  if (text === null) return jsonError("BAD_REQUEST", "`text` 必须是字符串。");

  const parsed = parseNovel(text);
  const source_fingerprint = computeSourceFingerprint(parsed.source_paragraphs);
  const startedAt = Date.now();
  try {
    const result = await selectScriptProvider().planScenes({
      source_fingerprint,
      chapters: parsed.chapters,
      source_paragraphs: parsed.source_paragraphs,
      analysis: body.analysis as AnalyzeResult | undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error(`[plan-scenes] live provider failed after ${Date.now() - startedAt}ms:`, e);
    return jsonError("PROVIDER_ERROR", e instanceof Error ? e.message : String(e), 502);
  }
}
