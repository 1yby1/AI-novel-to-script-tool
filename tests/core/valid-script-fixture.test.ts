import { describe, it, expect } from "vitest";
import { validScript } from "../helpers/valid-script";
import { validateSchema } from "../../src/core/validate/schema-validate";

describe("validScript fixture", () => {
  it("is structurally schema-valid with no warnings", () => {
    const r = validateSchema(validScript());
    expect(r.valid).toBe(true);
    expect(r.warnings).toEqual([]);
  });
  it("returns a fresh object each call", () => {
    const a = validScript();
    a.episodes = [];
    expect(validScript().episodes).toHaveLength(3);
  });
});
