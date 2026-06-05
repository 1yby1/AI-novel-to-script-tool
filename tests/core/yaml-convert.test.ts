import { describe, it, expect } from "vitest";
import { scriptToYaml, parseScriptYaml } from "../../src/core/yaml/convert";
import { validScript } from "../helpers/valid-script";

describe("yaml convert", () => {
  it("round-trips a script (script -> yaml -> parse deep-equals)", () => {
    const s = validScript();
    const text = scriptToYaml(s);
    const r = parseScriptYaml(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual(s);
  });

  it("produces a string that contains a top-level key", () => {
    expect(scriptToYaml(validScript())).toContain("schema_version");
  });

  it("returns a YAML_SYNTAX_ERROR item (not a throw) on malformed YAML", () => {
    const r = parseScriptYaml("foo: [unclosed");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("YAML_SYNTAX_ERROR");
  });
});
