import { NextResponse } from "next/server";
import { parseScriptYaml } from "../../../core/yaml/convert";
import { validateScriptObject } from "../../../core/validate/full";
import { jsonError, readJsonBody, stringArrayField, stringField } from "../_lib/http";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await readJsonBody(request);
  if (!body) return jsonError("BAD_REQUEST", "请求体必须是 JSON 对象。");

  const yaml = stringField(body, "yaml");
  if (yaml === null) return jsonError("BAD_REQUEST", "`yaml` 必须是字符串。");

  const parsed = parseScriptYaml(yaml);
  if (!parsed.ok) {
    return NextResponse.json({
      valid: false,
      errors: [parsed.error],
      warnings: [],
      quality_report: null,
    });
  }

  const sourceParagraphIds = stringArrayField(body, "source_paragraph_ids");
  const sourceFingerprint = stringField(body, "source_fingerprint");
  const canonical = sourceParagraphIds && sourceFingerprint
    ? { paragraphIds: sourceParagraphIds, fingerprint: sourceFingerprint }
    : undefined;

  const result = validateScriptObject(parsed.data, { mode: "edit", canonical });
  return NextResponse.json(result);
}
