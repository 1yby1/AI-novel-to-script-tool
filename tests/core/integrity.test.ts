import { describe, it, expect } from "vitest";
import { checkIntegrity } from "../../src/core/validate/integrity";
import { validScript } from "../helpers/valid-script";

describe("checkIntegrity", () => {
  it("passes a clean script with no errors or warnings", () => {
    const r = checkIntegrity(validScript());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("flags duplicate paragraph ids as DUPLICATE_ID", () => {
    const s = validScript();
    s.source_paragraphs[1]!.id = s.source_paragraphs[0]!.id;
    expect(checkIntegrity(s).errors.some((e) => e.code === "DUPLICATE_ID" && e.path === "source_paragraphs")).toBe(true);
  });

  it("flags duplicate character ids", () => {
    const s = validScript();
    s.characters.push({ ...s.characters[0]! });
    expect(checkIntegrity(s).errors.some((e) => e.code === "DUPLICATE_ID" && e.path === "characters")).toBe(true);
  });

  it("flags duplicate episode_no as DUPLICATE_NUMBER", () => {
    const s = validScript();
    s.episodes[1]!.episode_no = 1;
    expect(checkIntegrity(s).errors.some((e) => e.code === "DUPLICATE_NUMBER")).toBe(true);
  });

  it("flags non-sequential beat numbers as a NON_SEQUENTIAL warning (not a hard error)", () => {
    const s = validScript();
    s.episodes[0]!.scenes[0]!.beats[1]!.beat_no = 5; // [1, 5] -> gap
    const r = checkIntegrity(s);
    expect(r.warnings.some((w) => w.code === "NON_SEQUENTIAL")).toBe(true);
    expect(r.errors.some((e) => e.code === "NON_SEQUENTIAL")).toBe(false);
  });
});
