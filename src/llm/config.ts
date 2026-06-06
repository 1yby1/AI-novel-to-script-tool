export interface LlmConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
}

/** Whether a usable OpenAI-compatible API key is configured. */
export function hasApiKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0);
}

/** Read live-LLM config from env. Throws if no API key (call hasApiKey() first). */
export function getLlmConfig(): LlmConfig {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("缺少 OPENAI_API_KEY，无法使用 live 模式。");
  const retriesRaw = Number(process.env.LLM_MAX_RETRIES);
  const timeoutRaw = Number(process.env.OPENAI_TIMEOUT_MS);
  return {
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
    model: process.env.MODEL_NAME?.trim() || "gpt-4o-mini",
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 60000,
    maxRetries: Number.isFinite(retriesRaw) && retriesRaw >= 0 ? retriesRaw : 2,
  };
}
