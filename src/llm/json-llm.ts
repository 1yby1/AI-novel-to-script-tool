import type { ZodType } from "zod";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type CompleteFn = (messages: ChatMessage[]) => Promise<string>;

/** Extract the first balanced JSON value from model output (strips ``` fences and prose). */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : text;
  const start = body.search(/[{[]/);
  if (start === -1) return body.trim();
  const open = body[start]!;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return body.slice(start).trim();
}

export interface CallJsonOptions<T> {
  complete: CompleteFn;
  messages: ChatMessage[];
  schema: ZodType<T>;
  label: string;
  maxRetries?: number;
}

/**
 * Call an LLM expecting JSON, validate against a Zod schema, and on parse/validation
 * failure feed the error back and retry (spec §9). Throws after maxRetries (default 2).
 */
export async function callJson<T>(opts: CallJsonOptions<T>): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  const messages: ChatMessage[] = [...opts.messages];
  let lastError = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const raw = await opts.complete(messages);
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch (e) {
      lastError = `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`;
      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: `${lastError}。请只返回合法 JSON，不要任何解释或 markdown 围栏。` });
      continue;
    }
    const result = opts.schema.safeParse(parsed);
    if (result.success) return result.data;
    lastError = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    messages.push({ role: "assistant", content: raw });
    messages.push({ role: "user", content: `输出不符合 ${opts.label} 结构：${lastError}。请修正并只返回合法 JSON。` });
  }
  throw new Error(`LLM ${opts.label} 在 ${maxRetries + 1} 次尝试后仍未产出合法结果：${lastError}`);
}
