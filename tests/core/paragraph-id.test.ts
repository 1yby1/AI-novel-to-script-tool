import { describe, it, expect } from "vitest";
import { hash8, makeParagraphId } from "../../src/core/parse/paragraph-id";

describe("hash8", () => {
  it("returns 8 lowercase hex chars", () => {
    expect(hash8("hello")).toMatch(/^[0-9a-f]{8}$/);
  });
  it("is deterministic", () => {
    expect(hash8("林深归来")).toBe(hash8("林深归来"));
  });
  it("is whitespace-invariant (collapses runs, trims)", () => {
    expect(hash8("你好 世界")).toBe(hash8("  你好  世界  "));
  });
  it("differs for different content", () => {
    expect(hash8("甲")).not.toBe(hash8("乙"));
  });
});

describe("makeParagraphId", () => {
  it("formats as ch{c}_p{p}_{hash8}", () => {
    expect(makeParagraphId(1, 3, "林深踏上栈桥")).toMatch(/^ch1_p3_[0-9a-f]{8}$/);
  });
  it("is stable across leading/trailing whitespace", () => {
    expect(makeParagraphId(1, 3, "林深踏上栈桥")).toBe(makeParagraphId(1, 3, "  林深踏上栈桥\n"));
  });
});
