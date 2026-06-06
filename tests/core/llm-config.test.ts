import { describe, it, expect, afterEach } from "vitest";
import { hasApiKey, getLlmConfig } from "../../src/llm/config";

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("llm config", () => {
  it("hasApiKey reflects OPENAI_API_KEY presence", () => {
    delete process.env.OPENAI_API_KEY;
    expect(hasApiKey()).toBe(false);
    process.env.OPENAI_API_KEY = "sk-test";
    expect(hasApiKey()).toBe(true);
  });

  it("getLlmConfig throws without a key", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => getLlmConfig()).toThrow();
  });

  it("getLlmConfig applies defaults and overrides", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.OPENAI_BASE_URL;
    delete process.env.MODEL_NAME;
    delete process.env.LLM_MAX_RETRIES;
    const a = getLlmConfig();
    expect(a.model).toBe("gpt-4o-mini");
    expect(a.maxRetries).toBe(2);
    expect(a.baseURL).toBeUndefined();

    process.env.OPENAI_BASE_URL = "https://example.com/v1";
    process.env.MODEL_NAME = "qwen-max";
    process.env.LLM_MAX_RETRIES = "1";
    const b = getLlmConfig();
    expect(b.baseURL).toBe("https://example.com/v1");
    expect(b.model).toBe("qwen-max");
    expect(b.maxRetries).toBe(1);
  });
});
