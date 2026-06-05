import { describe, it, expect } from "vitest";
import { normalizeText, canonicalizeForHash } from "../../src/core/parse/normalize";

describe("normalizeText", () => {
  it("unifies CRLF/CR to LF", () => {
    expect(normalizeText("a\r\nb\rc")).toBe("a\nb\nc");
  });
  it("collapses spaces/tabs and trims each line", () => {
    expect(normalizeText("  a   b \t c  ")).toBe("a b c");
  });
  it("collapses 3+ blank lines into one blank line", () => {
    expect(normalizeText("a\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("canonicalizeForHash", () => {
  it("collapses all whitespace (incl. newlines) to single spaces and trims", () => {
    expect(canonicalizeForHash("  你好\n\n世界 ")).toBe("你好 世界");
  });
  it("is idempotent", () => {
    const once = canonicalizeForHash("a\n b ");
    expect(canonicalizeForHash(once)).toBe(once);
  });
});
