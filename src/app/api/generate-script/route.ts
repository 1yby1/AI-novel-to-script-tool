import { NextResponse } from "next/server";
import { parseNovel } from "../../../core/parse/chapters";
import { computeSourceFingerprint } from "../../../core/parse/fingerprint";
import { scriptToYaml } from "../../../core/yaml/convert";
import { validateScriptObject } from "../../../core/validate/full";
import { selectScriptProvider } from "../../../llm/get-provider";
import type { AnalyzeResult, PlanScenesResult } from "../../../llm/provider";
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
    const generated = await selectScriptProvider().generateScript({
      source_fingerprint,
      chapters: parsed.chapters,
      source_paragraphs: parsed.source_paragraphs,
      analysis: body.analysis as AnalyzeResult | undefined,
      plan: body.plan as PlanScenesResult | undefined,
      created_at: new Date().toISOString(),
      model: process.env.MODEL_NAME?.trim() || "gpt-4o-mini",
    });
    const canonical = {
      paragraphIds: parsed.source_paragraphs.map((p) => p.id),
      fingerprint: source_fingerprint,
    };
    const validation_result = validateScriptObject(generated.script_json, { mode: "generate", canonical });
    const script_json = validation_result.script ?? generated.script_json;
    return NextResponse.json({
      script_json,
      script_yaml: scriptToYaml(script_json),
      validation_result,
      quality_report: validation_result.quality_report,
    });
  } catch (e) {
    console.error(`[generate-script] live provider failed after ${Date.now() - startedAt}ms:`, e);
    return jsonError("PROVIDER_ERROR", e instanceof Error ? e.message : String(e), 502);
  }
}
