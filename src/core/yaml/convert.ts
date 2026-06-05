import { parse, stringify } from "yaml";
import type { ValidationItem } from "../validate/schema-validate";

/** Serialize a script object to YAML text. */
export function scriptToYaml(script: unknown): string {
  return stringify(script);
}

export type ParseYamlResult =
  | { ok: true; data: unknown }
  | { ok: false; error: ValidationItem };

/** Parse YAML; on a syntax error return a YAML_SYNTAX_ERROR item instead of throwing. */
export function parseScriptYaml(text: string): ParseYamlResult {
  try {
    return { ok: true, data: parse(text) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { path: "", code: "YAML_SYNTAX_ERROR", message } };
  }
}
