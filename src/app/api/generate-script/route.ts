import { parseNovel } from "../../../core/parse/chapters";
import { computeSourceFingerprint } from "../../../core/parse/fingerprint";
import { scriptToYaml } from "../../../core/yaml/convert";
import { validateScriptObject } from "../../../core/validate/full";
import { selectScriptProvider } from "../../../llm/get-provider";
import type { AnalyzeResult, PlanScenesResult } from "../../../llm/provider";
import { jsonError, readJsonBody, stringField } from "../_lib/http";

/**
 * Streams newline-delimited JSON so the client can show live progress during the
 * (multi-minute) per-episode generation:
 *   {"type":"progress","phase":"episode_done","episode_no":2}
 *   {"type":"progress","phase":"validating"}
 *   {"type":"result", script_json, script_yaml, validation_result, quality_report}
 *   {"type":"error","message":"..."}
 * Progress lines are best-effort; the final result/error line is the source of truth,
 * so generation correctness never depends on intermediate events being delivered.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return jsonError("BAD_REQUEST", "请求体必须是 JSON 对象。");

  const text = stringField(body, "text");
  if (text === null) return jsonError("BAD_REQUEST", "`text` 必须是字符串。");

  const analysis = body.analysis as AnalyzeResult | undefined;
  const plan = body.plan as PlanScenesResult | undefined;

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown): void => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        const parsed = parseNovel(text);
        const source_fingerprint = computeSourceFingerprint(parsed.source_paragraphs);
        const generated = await selectScriptProvider().generateScript(
          {
            source_fingerprint,
            chapters: parsed.chapters,
            source_paragraphs: parsed.source_paragraphs,
            analysis,
            plan,
            created_at: new Date().toISOString(),
            model: process.env.MODEL_NAME?.trim() || "gpt-4o-mini",
          },
          (progress) => send({ type: "progress", ...progress }),
        );
        send({ type: "progress", phase: "finalizing" });
        const canonical = {
          paragraphIds: parsed.source_paragraphs.map((p) => p.id),
          fingerprint: source_fingerprint,
        };
        const validation_result = validateScriptObject(generated.script_json, { mode: "generate", canonical });
        const script_json = validation_result.script ?? generated.script_json;
        send({
          type: "result",
          script_json,
          script_yaml: scriptToYaml(script_json),
          validation_result,
          quality_report: validation_result.quality_report,
        });
      } catch (e) {
        console.error(`[generate-script] failed after ${Date.now() - startedAt}ms:`, e);
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
