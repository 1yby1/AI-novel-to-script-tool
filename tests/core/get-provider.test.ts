import { describe, it, expect, afterEach } from "vitest";
import { selectScriptProvider } from "../../src/llm/get-provider";
import { FixtureProvider } from "../../src/llm/fixture-provider";
import { LiveLLMProvider } from "../../src/llm/live-provider";

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("selectScriptProvider", () => {
  it("returns the fixture provider when no API key is set", () => {
    delete process.env.OPENAI_API_KEY;
    expect(selectScriptProvider()).toBeInstanceOf(FixtureProvider);
  });
  it("returns the live provider when a key is set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.DEMO_MODE;
    expect(selectScriptProvider()).toBeInstanceOf(LiveLLMProvider);
  });
  it("forces fixture when DEMO_MODE=fixture even with a key", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.DEMO_MODE = "fixture";
    expect(selectScriptProvider()).toBeInstanceOf(FixtureProvider);
  });
});
