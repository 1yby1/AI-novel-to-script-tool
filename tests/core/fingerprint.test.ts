import { describe, it, expect } from "vitest";
import { computeSourceFingerprint } from "../../src/core/parse/fingerprint";

describe("computeSourceFingerprint", () => {
  it("returns 16 lowercase hex chars", () => {
    expect(computeSourceFingerprint([{ id: "ch1_p1_x" }])).toMatch(/^[0-9a-f]{16}$/);
  });
  it("is deterministic", () => {
    const ps = [{ id: "a" }, { id: "b" }];
    expect(computeSourceFingerprint(ps)).toBe(computeSourceFingerprint(ps));
  });
  it("changes if any paragraph id changes", () => {
    expect(computeSourceFingerprint([{ id: "a" }])).not.toBe(computeSourceFingerprint([{ id: "a2" }]));
  });
  it("is order-sensitive", () => {
    expect(computeSourceFingerprint([{ id: "a" }, { id: "b" }])).not.toBe(computeSourceFingerprint([{ id: "b" }, { id: "a" }]));
  });
});
