import { NextResponse } from "next/server";
import { getScriptProvider } from "../../../llm/fixture-provider";
import { jsonError, readJsonBody, stringField } from "../_lib/http";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await readJsonBody(request);
  if (!body) return jsonError("BAD_REQUEST", "请求体必须是 JSON 对象。");

  const source_fingerprint = stringField(body, "source_fingerprint");
  if (!source_fingerprint) return jsonError("BAD_REQUEST", "`source_fingerprint` 必须是字符串。");

  try {
    return NextResponse.json(await getScriptProvider().planScenes({ source_fingerprint }));
  } catch (e) {
    return jsonError("FIXTURE_ONLY", e instanceof Error ? e.message : String(e), 409);
  }
}
