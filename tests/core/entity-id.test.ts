import { describe, it, expect } from "vitest";
import { makeEntityId, canonicalizeName, asciiSlug } from "../../src/core/entities/entity-id";

describe("canonicalizeName", () => {
  it("removes whitespace and lowercases", () => {
    expect(canonicalizeName("  Old   Dock ")).toBe("olddock");
  });
});

describe("asciiSlug", () => {
  it("keeps lowercase alphanumerics only", () => {
    expect(asciiSlug("Lin Shen")).toBe("linshen");
  });
  it("is empty for purely non-ASCII names", () => {
    expect(asciiSlug("林深")).toBe("");
  });
});

describe("makeEntityId", () => {
  it("is deterministic for the same name", () => {
    expect(makeEntityId("char", "林深")).toBe(makeEntityId("char", "林深"));
  });
  it("omits the slug for non-ASCII names", () => {
    expect(makeEntityId("char", "林深")).toMatch(/^char_[0-9a-f]{6}$/);
  });
  it("includes an ASCII slug when available", () => {
    expect(makeEntityId("char", "Lin Shen")).toMatch(/^char_linshen_[0-9a-f]{6}$/);
  });
  it("is invariant to case/whitespace in the name", () => {
    expect(makeEntityId("loc", "Old Dock")).toBe(makeEntityId("loc", "  old   dock "));
  });
  it("differs for different names", () => {
    expect(makeEntityId("char", "林深")).not.toBe(makeEntityId("char", "苏晚"));
  });
});
