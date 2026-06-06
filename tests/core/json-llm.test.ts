import { describe, it, expect } from "vitest";
import { z } from "zod";
import { extractJson, callJson, type CompleteFn } from "../../src/llm/json-llm";

describe("extractJson", () => {
  it("returns plain JSON unchanged", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });
  it("strips markdown fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("extracts the first balanced object from surrounding prose", () => {
    expect(extractJson('Sure! {"a":{"b":2}} done')).toBe('{"a":{"b":2}}');
  });
  it("ignores braces inside strings", () => {
    expect(extractJson('{"a":"}{"}')).toBe('{"a":"}{"}');
  });
});

const Schema = z.object({ name: z.string() });

function scripted(responses: string[]): { fn: CompleteFn; calls: () => number } {
  let i = 0;
  return {
    fn: async () => responses[Math.min(i++, responses.length - 1)]!,
    calls: () => i,
  };
}

describe("callJson", () => {
  it("returns validated data on first success", async () => {
    const s = scripted(['{"name":"林深"}']);
    const out = await callJson({ complete: s.fn, messages: [{ role: "user", content: "x" }], schema: Schema, label: "t" });
    expect(out.name).toBe("林深");
    expect(s.calls()).toBe(1);
  });

  it("retries with feedback after a bad response, then succeeds", async () => {
    const s = scripted(["not json", '{"name":"苏晚"}']);
    const out = await callJson({ complete: s.fn, messages: [{ role: "user", content: "x" }], schema: Schema, label: "t", maxRetries: 2 });
    expect(out.name).toBe("苏晚");
    expect(s.calls()).toBe(2);
  });

  it("throws after exhausting retries", async () => {
    const s = scripted(["nope"]);
    await expect(
      callJson({ complete: s.fn, messages: [{ role: "user", content: "x" }], schema: Schema, label: "t", maxRetries: 1 }),
    ).rejects.toThrow(/t/);
    expect(s.calls()).toBe(2); // initial + 1 retry
  });
});
