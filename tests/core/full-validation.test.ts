import { describe, expect, it } from "vitest";
import { computeSourceFingerprint } from "../../src/core/parse/fingerprint";
import { validateScriptObject } from "../../src/core/validate/full";
import { validScript } from "../helpers/valid-script";

function canonicalOf(script = validScript()) {
  return {
    paragraphIds: script.source_paragraphs.map((p) => p.id),
    fingerprint: computeSourceFingerprint(script.source_paragraphs),
  };
}

describe("validateScriptObject", () => {
  it("validates a clean script with strong anchor and recomputes quality_report", () => {
    const script = validScript();
    const canonical = canonicalOf(script);
    script.metadata.source_fingerprint = canonical.fingerprint;

    const result = validateScriptObject(script, { mode: "generate", canonical });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.quality_report?.source_coverage_ratio).toBe(1);
    expect(result.script?.quality_report).toEqual(result.quality_report);
  });

  it("strips invalid source refs in generate mode and records repaired_refs", () => {
    const script = validScript();
    const canonical = canonicalOf(script);
    script.metadata.source_fingerprint = canonical.fingerprint;
    script.episodes[0]!.scenes[0]!.beats[0]!.source_refs = ["ch9_p9_bad"];

    const result = validateScriptObject(script, { mode: "generate", canonical });

    expect(result.valid).toBe(true);
    expect(result.quality_report?.repaired_refs).toEqual(["ch9_p9_bad"]);
    expect(result.script?.episodes[0]!.scenes[0]!.beats[0]!.source_refs).toEqual([]);
  });

  it("upgrades constraint warnings to hard violations in edit mode", () => {
    const script = validScript();
    const canonical = canonicalOf(script);
    script.metadata.source_fingerprint = canonical.fingerprint;
    script.episodes = script.episodes.slice(0, 2);

    const result = validateScriptObject(script, { mode: "edit", canonical });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "CONSTRAINT_VIOLATION" && e.path === "episodes")).toBe(true);
  });

  it("emits WEAK_TRACEABILITY warnings when a scene has no source refs", () => {
    const script = validScript();
    const canonical = canonicalOf(script);
    script.metadata.source_fingerprint = canonical.fingerprint;
    const scene = script.episodes[0]!.scenes[0]!;
    scene.source_refs = [];
    scene.beats.forEach((beat) => { beat.source_refs = []; });

    const result = validateScriptObject(script, { mode: "generate", canonical });

    expect(result.warnings.some((w) => w.code === "WEAK_TRACEABILITY" && w.path === "episodes[0].scenes[0]")).toBe(true);
  });

  it("ignores a mangled/deleted quality_report and recomputes it instead of failing", () => {
    const script = validScript();
    const canonical = canonicalOf(script);
    script.metadata.source_fingerprint = canonical.fingerprint;
    (script as { quality_report: unknown }).quality_report = { source_coverage_ratio: 9, bogus: true };
    const result = validateScriptObject(script, { mode: "edit", canonical });
    expect(result.valid).toBe(true);
    expect(result.quality_report?.source_coverage_ratio).toBe(1);
  });
});
