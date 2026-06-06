import { hasApiKey } from "./config";
import { FixtureProvider } from "./fixture-provider";
import { createLiveProvider } from "./live-provider";
import type { ScriptProvider } from "./provider";

/**
 * Choose the provider by environment: live iff an OPENAI_API_KEY is present and
 * DEMO_MODE is not forced to "fixture"; otherwise the deterministic fixture provider.
 */
export function selectScriptProvider(): ScriptProvider {
  if (hasApiKey() && process.env.DEMO_MODE !== "fixture") {
    return createLiveProvider();
  }
  return new FixtureProvider();
}
