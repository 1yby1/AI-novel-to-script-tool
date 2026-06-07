import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseNovel } from "../../src/core/parse/chapters";
import { computeSourceFingerprint } from "../../src/core/parse/fingerprint";
import { parseScriptYaml } from "../../src/core/yaml/convert";
import { validateScriptObject } from "../../src/core/validate/full";
import { DEMO_SOURCE_FINGERPRINT, FixtureProvider, loadDemoNovel } from "../../src/llm/fixture-provider";

function fixturePath(file: string): string {
  return path.join(process.cwd(), "fixtures", file);
}

describe("fixture pipeline", () => {
  it("parses the demo novel to the fixture fingerprint", () => {
    const parsed = parseNovel(loadDemoNovel());
    expect(parsed.checks.meets_minimum_chapters).toBe(true);
    expect(parsed.source_paragraphs).toHaveLength(6);
    expect(computeSourceFingerprint(parsed.source_paragraphs)).toBe(DEMO_SOURCE_FINGERPRINT);
  });

  it("runs analyze, plan, generate, strong-anchor validation", async () => {
    const parsed = parseNovel(loadDemoNovel());
    const source_fingerprint = computeSourceFingerprint(parsed.source_paragraphs);
    const provider = new FixtureProvider();

    const analysis = await provider.analyze({ source_fingerprint });
    const plan = await provider.planScenes({ source_fingerprint });
    const generated = await provider.generateScript({ source_fingerprint });
    const validation = validateScriptObject(generated.script_json, {
      mode: "generate",
      canonical: {
        paragraphIds: parsed.source_paragraphs.map((p) => p.id),
        fingerprint: source_fingerprint,
      },
    });

    expect(analysis.characters.map((c) => c.id)).toContain("char_aadd69");
    expect(analysis.key_events[0]!.id).toBe("evt_return_to_port");
    expect(analysis.hook_candidates.length).toBeGreaterThan(0);
    expect(plan.scene_plan).toHaveLength(6);
    expect(plan.coverage.coverage_ratio).toBe(1);
    expect(plan.scene_plan[0]!.purpose).toContain("归港");
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.quality_report?.source_coverage_ratio).toBe(1);
  });

  it("rejects non-demo fingerprints in fixture mode", async () => {
    await expect(new FixtureProvider().analyze({ source_fingerprint: "not-demo" })).rejects.toThrow(/fixture/);
  });

  it("parses and validates the YAML fixture", () => {
    const yaml = readFileSync(fixturePath("demo-script.yaml"), "utf8");
    const parsedYaml = parseScriptYaml(yaml);
    expect(parsedYaml.ok).toBe(true);
    if (!parsedYaml.ok) return;

    const parsedNovel = parseNovel(loadDemoNovel());
    const validation = validateScriptObject(parsedYaml.data, {
      mode: "generate",
      canonical: {
        paragraphIds: parsedNovel.source_paragraphs.map((p) => p.id),
        fingerprint: computeSourceFingerprint(parsedNovel.source_paragraphs),
      },
    });
    expect(validation.valid).toBe(true);
  });
});
