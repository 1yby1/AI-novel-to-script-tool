import { describe, it, expect } from "vitest";
import { computeQualityReport } from "../../src/core/validate/quality-report";
import { validScript } from "../helpers/valid-script";

describe("computeQualityReport", () => {
  it("reports full coverage and no problems for a clean script", () => {
    const r = computeQualityReport(validScript());
    expect(r.total_paragraph_count).toBe(3);
    expect(r.referenced_paragraph_count).toBe(3);
    expect(r.source_coverage_ratio).toBe(1);
    expect(r.missing_source_refs).toEqual([]);
    expect(r.untraceable_scenes).toEqual([]);
  });

  it("ignores any embedded quality_report and recomputes", () => {
    const s = validScript();
    s.quality_report.source_coverage_ratio = 0.01;
    s.quality_report.total_paragraph_count = 999;
    const r = computeQualityReport(s);
    expect(r.source_coverage_ratio).toBe(1);
    expect(r.total_paragraph_count).toBe(3);
  });

  it("lists invalid references in missing_source_refs and lowers coverage", () => {
    const s = validScript();
    s.episodes[2]!.scenes[0]!.beats.forEach((b) => (b.source_refs = ["ch9_p9_nope"]));
    s.episodes[2]!.scenes[0]!.source_refs = ["ch9_p9_nope"];
    const r = computeQualityReport(s);
    expect(r.missing_source_refs).toContain("ch9_p9_nope");
    expect(r.referenced_paragraph_count).toBe(2);
    expect(r.source_coverage_ratio).toBeCloseTo(2 / 3, 4);
  });

  it("marks a scene with no scene-level and no beat-level refs as untraceable", () => {
    const s = validScript();
    const sc = s.episodes[0]!.scenes[0]!;
    sc.source_refs = [];
    sc.beats.forEach((b) => (b.source_refs = []));
    const r = computeQualityReport(s);
    expect(r.untraceable_scenes).toContain("episodes[0].scenes[0]");
  });

  it("passes through repaired_refs and constraint warnings, and emits suggestions", () => {
    const r = computeQualityReport(validScript(), {
      repairedRefs: ["ch9_p9_bad"],
      constraintWarnings: [{ path: "episodes", code: "CONSTRAINT_WARNING", message: "集数不一致" }],
    });
    expect(r.repaired_refs).toEqual(["ch9_p9_bad"]);
    expect(r.constraint_warnings).toEqual([{ code: "CONSTRAINT_WARNING", message: "集数不一致" }]);
    expect(r.manual_review_suggestions).toContain("集数不一致");
  });

  it("uses canonical total when provided", () => {
    const r = computeQualityReport(validScript(), { canonicalParagraphIds: ["ch1_p1_aaaa1111", "ch2_p1_bbbb2222", "ch3_p1_cccc3333", "ch4_p1_extra"] });
    expect(r.total_paragraph_count).toBe(4);
    expect(r.source_coverage_ratio).toBeCloseTo(3 / 4, 4);
  });
});
