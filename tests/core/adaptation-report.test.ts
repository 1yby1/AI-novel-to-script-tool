import { describe, it, expect } from "vitest";
import { buildAdaptationReport } from "../../src/core/report/adaptation-report";
import { validScript } from "../helpers/valid-script";

describe("buildAdaptationReport", () => {
  it("includes title, constraints, coverage, episodes, notes, suggestions", () => {
    const md = buildAdaptationReport(validScript());
    expect(md).toContain("# 改编报告");
    expect(md).toContain("雾港旧约"); // metadata.title
    expect(md).toContain("## 改编约束");
    expect(md).toContain("覆盖率");
    expect(md).toContain("100%"); // fixture quality_report coverage = 1
    expect(md).toContain("## 分集概览");
    expect(md).toContain("第1集");
    expect(md).toContain("合并"); // adaptation_notes type "merge" label
  });

  it("renders （无）for empty notes and suggestions instead of crashing", () => {
    const s = validScript();
    s.adaptation_notes = [];
    s.quality_report.manual_review_suggestions = [];
    const md = buildAdaptationReport(s);
    expect(md).toContain("## 改编说明");
    expect(md).toContain("（无）");
  });

  it("lists invalid and repaired refs counts in the traceability section", () => {
    const s = validScript();
    s.quality_report.missing_source_refs = ["ch9_p9_bad"];
    s.quality_report.repaired_refs = ["ch9_p9_gone"];
    const md = buildAdaptationReport(s);
    expect(md).toContain("无效引用：1");
    expect(md).toContain("ch9_p9_bad");
    expect(md).toContain("自动剔除引用：1");
  });
});
