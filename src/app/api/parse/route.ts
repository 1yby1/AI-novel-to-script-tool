import { NextResponse } from "next/server";
import { computeSourceFingerprint } from "../../../core/parse/fingerprint";
import { parseNovel } from "../../../core/parse/chapters";
import { jsonError, readJsonBody, stringField } from "../_lib/http";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await readJsonBody(request);
  if (!body) return jsonError("BAD_REQUEST", "请求体必须是 JSON 对象。");

  const text = stringField(body, "text");
  if (text === null) return jsonError("BAD_REQUEST", "`text` 必须是字符串。");

  const parsed = parseNovel(text);
  return NextResponse.json({
    ...parsed,
    source_fingerprint: computeSourceFingerprint(parsed.source_paragraphs),
  });
}
