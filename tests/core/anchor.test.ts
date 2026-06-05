import { describe, it, expect } from "vitest";
import { checkAnchor } from "../../src/core/validate/anchor";
import { computeSourceFingerprint } from "../../src/core/parse/fingerprint";
import { validScript } from "../helpers/valid-script";

function canonicalOf(s = validScript()) {
  const paragraphIds = s.source_paragraphs.map((p) => p.id);
  return { paragraphIds, fingerprint: computeSourceFingerprint(s.source_paragraphs) };
}

describe("checkAnchor (with canonical)", () => {
  it("passes when fingerprint and paragraphs match canonical", () => {
    const s = validScript();
    const canonical = canonicalOf(s);
    s.metadata.source_fingerprint = canonical.fingerprint;
    expect(checkAnchor(s, canonical).errors).toEqual([]);
  });

  it("flags SOURCE_MISMATCH when the fingerprint differs", () => {
    const s = validScript();
    const canonical = canonicalOf(s);
    s.metadata.source_fingerprint = "deadbeefdeadbeef";
    expect(checkAnchor(s, canonical).errors.some((e) => e.code === "SOURCE_MISMATCH" && e.path === "metadata.source_fingerprint")).toBe(true);
  });

  it("flags SOURCE_MISMATCH when a YAML paragraph id is not in canonical", () => {
    const s = validScript();
    const canonical = canonicalOf(s);
    s.metadata.source_fingerprint = canonical.fingerprint;
    s.source_paragraphs[0]!.id = "ch1_p1_forged0";
    expect(checkAnchor(s, canonical).errors.some((e) => e.code === "SOURCE_MISMATCH")).toBe(true);
  });
});

describe("checkAnchor (standalone, no canonical)", () => {
  it("warns SOURCE_UNVERIFIED and passes when the embedded fingerprint matches its own paragraphs", () => {
    const s = validScript();
    s.metadata.source_fingerprint = computeSourceFingerprint(s.source_paragraphs);
    const r = checkAnchor(s);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.code === "SOURCE_UNVERIFIED")).toBe(true);
  });

  it("flags SOURCE_MISMATCH when the embedded fingerprint does not match its own paragraphs", () => {
    const s = validScript();
    s.metadata.source_fingerprint = "0000000000000000";
    expect(checkAnchor(s).errors.some((e) => e.code === "SOURCE_MISMATCH")).toBe(true);
  });
});
