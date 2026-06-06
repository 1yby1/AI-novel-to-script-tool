import { NextResponse } from "next/server";
import { computeSourceFingerprint } from "../../../core/parse/fingerprint";
import { scriptToYaml } from "../../../core/yaml/convert";
import { validateScriptObject } from "../../../core/validate/full";
import { getScriptProvider } from "../../../llm/fixture-provider";
import { jsonError, readJsonBody, stringArrayField, stringField } from "../_lib/http";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await readJsonBody(request);
  if (!body) return jsonError("BAD_REQUEST", "请求体必须是 JSON 对象。");

  const source_fingerprint = stringField(body, "source_fingerprint");
  if (!source_fingerprint) return jsonError("BAD_REQUEST", "`source_fingerprint` 必须是字符串。");

  try {
    const generated = await getScriptProvider().generateScript({ source_fingerprint });
    const sourceParagraphIds = stringArrayField(body, "source_paragraph_ids") ?? generated.script_json.source_paragraphs.map((p) => p.id);
    const canonical = {
      paragraphIds: sourceParagraphIds,
      fingerprint: source_fingerprint || computeSourceFingerprint(generated.script_json.source_paragraphs),
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
    return jsonError("FIXTURE_ONLY", e instanceof Error ? e.message : String(e), 409);
  }
}
