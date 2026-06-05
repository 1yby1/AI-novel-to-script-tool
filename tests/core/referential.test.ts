import { describe, it, expect } from "vitest";
import { checkReferential } from "../../src/core/validate/referential";
import { validScript } from "../helpers/valid-script";

describe("checkReferential", () => {
  it("returns no errors for a fully consistent script", () => {
    expect(checkReferential(validScript())).toEqual([]);
  });

  it("flags an invalid source_ref on a beat with its path", () => {
    const s = validScript();
    s.episodes[0]!.scenes[0]!.beats[0]!.source_refs = ["ch9_p9_nope"];
    const errs = checkReferential(s);
    expect(errs.some((e) => e.code === "INVALID_SOURCE_REF" && e.path === "episodes[0].scenes[0].beats[0].source_refs[0]")).toBe(true);
  });

  it("flags an invalid location_id", () => {
    const s = validScript();
    s.episodes[0]!.scenes[0]!.heading.location_id = "loc_missing";
    expect(checkReferential(s).some((e) => e.code === "INVALID_LOCATION_REF" && e.path === "episodes[0].scenes[0].heading.location_id")).toBe(true);
  });

  it("flags an invalid present_character_id and a dialogue beat character_id", () => {
    const s = validScript();
    s.episodes[0]!.scenes[0]!.present_character_ids = ["char_ghost"];
    const beat = s.episodes[0]!.scenes[0]!.beats[1]!;
    if (beat.type === "dialogue") beat.character_id = "char_ghost";
    const errs = checkReferential(s);
    expect(errs.filter((e) => e.code === "INVALID_CHARACTER_REF")).toHaveLength(2);
  });

  it("flags a paragraph whose chapter_id does not exist", () => {
    const s = validScript();
    s.source_paragraphs[0]!.chapter_id = "ch_nope";
    expect(checkReferential(s).some((e) => e.code === "INVALID_CHAPTER_REF" && e.path === "source_paragraphs[0].chapter_id")).toBe(true);
  });

  it("flags an invalid source_ref on a character", () => {
    const s = validScript();
    s.characters[0]!.source_refs = ["ch9_p9_nope"];
    expect(checkReferential(s).some((e) => e.code === "INVALID_SOURCE_REF" && e.path === "characters[0].source_refs[0]")).toBe(true);
  });
});
