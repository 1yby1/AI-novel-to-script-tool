import OpenAI from "openai";
import type { LlmConfig } from "./config";
import type { ChatMessage, CompleteFn } from "./json-llm";

/**
 * SDK-level network retries (transient 429 / 5xx / timeout). Kept small and DECOUPLED from the
 * content-retry loop (LLM_MAX_RETRIES) so the two don't multiply into multi-minute hangs:
 * previously a slow call was retried `maxRetries` times × the timeout (e.g. 3 × 60s = 3min).
 */
const NETWORK_RETRIES = 1;

/**
 * Build a `complete(messages)` function over an OpenAI-compatible Chat Completions endpoint.
 * Requests JSON output and returns the raw assistant text (callJson handles parsing/retry).
 */
export function makeComplete(config: LlmConfig): CompleteFn {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
    maxRetries: NETWORK_RETRIES,
  });
  return async (messages: ChatMessage[]): Promise<string> => {
    const completion = await client.chat.completions.create({
      model: config.model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });
    return completion.choices[0]?.message?.content ?? "";
  };
}
