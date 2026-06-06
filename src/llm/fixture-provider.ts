import { readFileSync } from "node:fs";
import path from "node:path";
import { ScriptSchema, type Script } from "../core/schema/script-schema";
import { DEMO_SOURCE_FINGERPRINT } from "./demo-fingerprint";
import type { AnalyzeInput, AnalyzeResult, GenerateInput, GenerateScriptResult, PlanInput, PlanScenesResult, ScriptProvider } from "./provider";

export { DEMO_SOURCE_FINGERPRINT } from "./demo-fingerprint";

function fixturePath(file: string): string {
  return path.join(process.cwd(), "fixtures", file);
}

function readTextFixture(file: string): string {
  return readFileSync(fixturePath(file), "utf8");
}

function readJsonFixture<T>(file: string): T {
  return JSON.parse(readTextFixture(file)) as T;
}

function assertDemoFingerprint(source_fingerprint: string): void {
  if (source_fingerprint !== DEMO_SOURCE_FINGERPRINT) {
    throw new Error("fixture 无此文本对应结果，请加载内置 Demo 或配置 OPENAI_API_KEY 使用 live 模式。");
  }
}

export function loadDemoNovel(): string {
  return readTextFixture("demo-novel.txt");
}

export class FixtureProvider implements ScriptProvider {
  async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    assertDemoFingerprint(input.source_fingerprint);
    return readJsonFixture<AnalyzeResult>("demo-analysis.json");
  }

  async planScenes(input: PlanInput): Promise<PlanScenesResult> {
    assertDemoFingerprint(input.source_fingerprint);
    return readJsonFixture<PlanScenesResult>("demo-plan.json");
  }

  async generateScript(input: GenerateInput): Promise<GenerateScriptResult> {
    assertDemoFingerprint(input.source_fingerprint);
    const raw = readJsonFixture<unknown>("demo-script.json");
    const script_json: Script = ScriptSchema.parse(raw);
    return {
      script_json,
      script_yaml: readTextFixture("demo-script.yaml"),
    };
  }
}

export function getScriptProvider(): ScriptProvider {
  return new FixtureProvider();
}
