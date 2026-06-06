"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Gauge,
  GitBranch,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  SearchCheck,
  Wand2,
} from "lucide-react";
import { DEMO_SOURCE_FINGERPRINT } from "../llm/demo-fingerprint";

interface ValidationItem {
  path: string;
  code: string;
  message: string;
}

interface SourceChapter {
  id: string;
  title: string;
  index: number;
  summary?: string;
}

interface SourceParagraph {
  id: string;
  chapter_id: string;
  paragraph_index: number;
  text?: string;
  text_preview: string;
  hash: string;
}

interface ParseResult {
  chapters: SourceChapter[];
  source_paragraphs: SourceParagraph[];
  source_fingerprint: string;
  mode: "live" | "fixture";
  stats: {
    chapter_count: number;
    paragraph_count: number;
    character_count: number;
  };
  checks: {
    meets_minimum_chapters: boolean;
    empty_input: boolean;
    detected_chapter_count: number;
  };
}

interface AnalyzeResult {
  characters: Array<{ id: string; name: string; role: string; motivation: string; source_refs: string[] }>;
  locations: Array<{ id: string; name: string; description: string; source_refs: string[] }>;
  key_events: string[];
  conflicts: string[];
}

interface PlanScenesResult {
  episodes: Array<{
    episode_no: number;
    title: string;
    opening_hook: string;
    cliffhanger: string;
    scene_refs: string[];
  }>;
  scene_plan: Array<{ episode_no: number; scene_no: number; location_id: string; summary: string }>;
  pacing_notes: string[];
  adaptation_strategy: string;
}

interface QualityReport {
  source_coverage_ratio: number;
  referenced_paragraph_count: number;
  total_paragraph_count: number;
  missing_source_refs: string[];
  repaired_refs: string[];
  untraceable_scenes: string[];
  constraint_warnings: Array<{ code: string; message: string }>;
  manual_review_suggestions: string[];
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationItem[];
  warnings: ValidationItem[];
  quality_report: QualityReport | null;
}

interface GenerateResult {
  script_yaml: string;
  validation_result: ValidationResult;
  quality_report: QualityReport | null;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message ?? `请求失败：${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(`请求失败：${response.status}`);
  return data as T;
}

function sourceParagraphIds(parseResult: ParseResult | null): string[] {
  return parseResult?.source_paragraphs.map((p) => p.id) ?? [];
}

export default function WorkbenchPage() {
  const [novelText, setNovelText] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [plan, setPlan] = useState<PlanScenesResult | null>(null);
  const [yamlText, setYamlText] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "info" | "error"; text: string } | null>({
    type: "info",
    text: "离线 Demo 模式（无需 API Key）",
  });

  const canUseFixture = parseResult?.source_fingerprint === DEMO_SOURCE_FINGERPRINT;
  const quality = validation?.quality_report ?? null;
  const canRun = Boolean(parseResult?.checks.meets_minimum_chapters && (canUseFixture || parseResult?.mode === "live"));

  const flowState = useMemo(() => {
    if (!parseResult) return "等待解析";
    if (!parseResult.checks.meets_minimum_chapters) return "章节不足";
    if (!analysis) return "等待分析";
    if (!plan) return "等待规划";
    if (!yamlText) return "等待生成";
    if (!validation) return "等待校验";
    return validation.valid ? "校验通过" : "需要修正";
  }, [analysis, parseResult, plan, validation, yamlText]);

  function resetDownstream() {
    setAnalysis(null);
    setPlan(null);
    setYamlText("");
    setValidation(null);
  }

  async function loadDemo() {
    setBusy("demo");
    try {
      const data = await getJson<{ text: string }>("/api/demo");
      setNovelText(data.text);
      setParseResult(null);
      resetDownstream();
      setMessage({ type: "info", text: "已载入内置 Demo 小说" });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function runParse() {
    setBusy("parse");
    try {
      const data = await postJson<ParseResult>("/api/parse", { text: novelText });
      setParseResult(data);
      resetDownstream();
      setMessage({
        type: data.checks.meets_minimum_chapters ? "info" : "error",
        text: data.checks.meets_minimum_chapters
          ? `解析完成：${data.stats.chapter_count} 章 / ${data.stats.paragraph_count} 段`
          : data.checks.empty_input
            ? "请先粘贴或载入小说文本"
            : `仅识别到 ${data.checks.detected_chapter_count} 个章节，本工具需至少 3 章（用"第X章"等标记分章）`,
      });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function runAnalyze() {
    if (!parseResult) return;
    setBusy("analyze");
    try {
      const data = await postJson<AnalyzeResult>("/api/analyze", {
        text: novelText,
      });
      setAnalysis(data);
      setPlan(null);
      setYamlText("");
      setValidation(null);
      setMessage({ type: "info", text: `分析完成：${data.characters.length} 人物 / ${data.locations.length} 地点` });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function runPlan() {
    if (!parseResult) return;
    setBusy("plan");
    try {
      const data = await postJson<PlanScenesResult>("/api/plan-scenes", {
        text: novelText,
        analysis,
      });
      setPlan(data);
      setYamlText("");
      setValidation(null);
      setMessage({ type: "info", text: `规划完成：${data.episodes.length} 集 / ${data.scene_plan.length} 场` });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function runGenerate() {
    if (!parseResult) return;
    setBusy("generate");
    try {
      const data = await postJson<GenerateResult>("/api/generate-script", {
        text: novelText,
        analysis,
        plan,
      });
      setYamlText(data.script_yaml);
      setValidation(data.validation_result);
      setMessage({
        type: data.validation_result.valid ? "info" : "error",
        text: data.validation_result.valid ? "已生成可编辑 YAML 初稿" : "已生成，但存在校验错误",
      });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function runValidate() {
    setBusy("validate");
    try {
      const data = await postJson<ValidationResult>("/api/validate-yaml", {
        yaml: yamlText,
        source_fingerprint: parseResult?.source_fingerprint,
        source_paragraph_ids: sourceParagraphIds(parseResult),
      });
      setValidation(data);
      setMessage({ type: data.valid ? "info" : "error", text: data.valid ? "YAML 校验通过" : "YAML 存在错误" });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const isBusy = busy !== null;
  const spinner = (action: string, Icon: typeof FileText) =>
    busy === action ? <Loader2 className="spin" size={15} /> : <Icon size={15} />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><FileText size={19} /></span>
          <div>
            <h1>Novel2Script</h1>
            <p>小说转剧本 · YAML 工作台</p>
          </div>
        </div>
        <div className="status-line">
          <span className={validation?.valid ? "badge good" : "badge"}>
            {validation?.valid ? <CheckCircle2 size={14} /> : <Gauge size={14} />}
            {flowState}
          </span>
          {parseResult ? (
            <span className={parseResult.mode === "live" ? "badge good" : "badge"} title="生成模式">
              {parseResult.mode === "live" ? "live 模式" : "离线 Demo"}
            </span>
          ) : null}
          {parseResult ? (
            <span className={canUseFixture ? "badge good" : "badge warn"} title="原文指纹">
              指纹 {parseResult.source_fingerprint}
            </span>
          ) : null}
        </div>
      </header>

      <section className="workspace">
        <div className="panel source-panel">
          <div className="panel-header">
            <h2 className="panel-title"><FileText size={16} /> 原文</h2>
          </div>
          <textarea
            aria-label="小说原文"
            className="input-area"
            placeholder="在此粘贴 3 章以上的小说文本，或点击“载入 Demo”体验内置示例。"
            value={novelText}
            onChange={(event) => {
              setNovelText(event.target.value);
              setParseResult(null);
              resetDownstream();
            }}
          />
          <div className="section source-controls">
            <div className="flow">
              <button className="btn" disabled={isBusy} onClick={loadDemo}>
                {spinner("demo", RefreshCw)}
                载入 Demo
              </button>
              <button className="btn primary" disabled={isBusy || novelText.trim().length === 0} onClick={runParse}>
                {spinner("parse", SearchCheck)}
                解析
              </button>
              <button className="btn" disabled={isBusy || !canRun} onClick={runAnalyze}>
                {spinner("analyze", ListChecks)}
                分析
              </button>
              <button className="btn" disabled={isBusy || !analysis} onClick={runPlan}>
                {spinner("plan", GitBranch)}
                规划
              </button>
              <button className="btn success" disabled={isBusy || !plan || !canRun} onClick={runGenerate}>
                {spinner("generate", Wand2)}
                生成
              </button>
              <button className="btn" disabled={isBusy || yamlText.trim().length === 0} onClick={runValidate}>
                {spinner("validate", Play)}
                校验
              </button>
            </div>
            {message ? <div className={`message ${message.type}`}>{message.text}</div> : null}
            {parseResult?.checks.meets_minimum_chapters && parseResult.mode === "fixture" && !canUseFixture ? (
              <p className="hint">
                离线 Demo 模式：仅内置 Demo 可生成。自定义文本请配置 <code>OPENAI_API_KEY</code> 启用 live 模式。
              </p>
            ) : null}
            {parseResult?.checks.meets_minimum_chapters && parseResult.mode === "live" && !canUseFixture ? (
              <p className="hint">live 模式：将调用真实 LLM 生成（分析 → 规划 → 生成，可能需要数十秒）。</p>
            ) : null}
          </div>
        </div>

        <div className="panel pipeline-panel">
          <div className="panel-header">
            <h2 className="panel-title"><ListChecks size={16} /> 流程</h2>
          </div>
          <div className="pipeline-scroll">
            <div className="section">
              <h2>解析</h2>
              {parseResult ? (
                <>
                  <div className="metric-grid">
                    <div className="metric"><strong>{parseResult.stats.chapter_count}</strong><span>章</span></div>
                    <div className="metric"><strong>{parseResult.stats.paragraph_count}</strong><span>段</span></div>
                    <div className="metric"><strong>{parseResult.stats.character_count}</strong><span>字</span></div>
                  </div>
                  <div className="list" style={{ marginTop: 10 }}>
                    {parseResult.source_paragraphs.slice(0, 6).map((p) => (
                      <div className="row" key={p.id}>
                        <div className="row-title"><span>{p.chapter_id} / 第{p.paragraph_index}段</span><span className="code">{p.id}</span></div>
                        <p>{p.text_preview}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="code">尚无解析结果</p>
              )}
            </div>

            <div className="section">
              <h2>人物 · 地点</h2>
              {analysis ? (
                <div className="list">
                  {[...analysis.characters, ...analysis.locations].map((item) => (
                    <div className="row" key={item.id}>
                      <div className="row-title"><span>{item.name}</span><span className="code">{item.id}</span></div>
                      <p>{"motivation" in item ? item.motivation : item.description}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="code">尚无分析结果</p>
              )}
            </div>

            <div className="section">
              <h2>分场规划</h2>
              {plan ? (
                <div className="list">
                  {plan.scene_plan.map((scene) => (
                    <div className="row" key={`${scene.episode_no}-${scene.scene_no}`}>
                      <div className="row-title">
                        <span>第{scene.episode_no}集 · 第{scene.scene_no}场</span>
                        <span className="code">{scene.location_id}</span>
                      </div>
                      <p>{scene.summary}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="code">尚无分场规划</p>
              )}
            </div>
          </div>
        </div>

        <div className="panel yaml-panel">
          <div className="panel-header">
            <h2 className="panel-title"><FileText size={16} /> YAML 剧本</h2>
            <button className="btn" disabled={isBusy || yamlText.trim().length === 0} onClick={runValidate}>
              {spinner("validate", SearchCheck)}
              重新校验
            </button>
          </div>
          <textarea
            aria-label="剧本 YAML"
            className="yaml-area"
            placeholder="生成后这里会出现可编辑的 YAML 剧本，改完点“重新校验”。"
            value={yamlText}
            onChange={(event) => setYamlText(event.target.value)}
          />
          <div className="section">
            <h2>质量</h2>
            {quality ? (
              <div className="quality">
                <div><strong>{Math.round(quality.source_coverage_ratio * 100)}%</strong><span>原文覆盖率</span></div>
                <div><strong>{quality.referenced_paragraph_count}/{quality.total_paragraph_count}</strong><span>引用/总段</span></div>
                <div><strong>{quality.untraceable_scenes.length}</strong><span>无溯源场景</span></div>
              </div>
            ) : (
              <p className="code">尚无质量报告</p>
            )}
          </div>
          <div className="section">
            <h2>校验结果</h2>
            {validation && validation.errors.length + validation.warnings.length > 0 ? (
              <div className="findings">
                {validation.errors.map((item, index) => (
                  <div className="finding error" key={`e-${index}`}>
                    <strong>{item.code}</strong> <span className="code">{item.path || "root"}</span>
                    <div>{item.message}</div>
                  </div>
                ))}
                {validation.warnings.map((item, index) => (
                  <div className="finding warning" key={`w-${index}`}>
                    <strong>{item.code}</strong> <span className="code">{item.path || "root"}</span>
                    <div>{item.message}</div>
                  </div>
                ))}
              </div>
            ) : validation ? (
              <div className="finding"><CheckCircle2 size={14} /> YAML 校验通过</div>
            ) : (
              <div className="finding"><AlertTriangle size={14} /> 尚无校验结果</div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
