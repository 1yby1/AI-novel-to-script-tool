"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Code2,
  Download,
  FileText,
  Gauge,
  GitBranch,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  SearchCheck,
  Upload,
  Wand2,
} from "lucide-react";
import { DEMO_SOURCE_FINGERPRINT } from "../llm/demo-fingerprint";
import { buildAdaptationReport } from "../core/report/adaptation-report";
import type { Script } from "../core/schema/script-schema";

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

interface ParseWarning {
  code: string;
  message: string;
  path?: string;
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
  warnings: ParseWarning[];
}

interface KeyEventCard {
  id: string;
  summary: string;
  dramatic_function: string;
  source_refs: string[];
}

interface ConflictCard {
  id: string;
  surface_conflict: string;
  stakes: string;
  source_refs: string[];
}

interface HookCandidate {
  id: string;
  description: string;
  why_it_hooks: string;
  source_refs: string[];
}

interface AnalyzeResult {
  characters: Array<{ id: string; name: string; role: string; motivation: string; source_refs: string[] }>;
  locations: Array<{ id: string; name: string; description: string; source_refs: string[] }>;
  key_events: KeyEventCard[];
  conflicts: ConflictCard[];
  hook_candidates: HookCandidate[];
  adaptation_warnings: string[];
}

interface PlanScenesResult {
  episodes: Array<{
    episode_no: number;
    title: string;
    opening_hook: string;
    main_goal: string;
    core_conflict: string;
    turning_point: string;
    cliffhanger: string;
    event_ids: string[];
    source_refs: string[];
  }>;
  scene_plan: Array<{
    episode_no: number;
    scene_no: number;
    location_id: string;
    purpose: string;
    conflict: string;
    emotional_shift: string;
    required_character_ids: string[];
    event_ids: string[];
    source_refs: string[];
    summary: string;
  }>;
  coverage: { covered_event_ids: string[]; omitted_event_ids: string[]; coverage_ratio: number };
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
  script?: Script | null;
}

interface GenerateResult {
  script_json: Script;
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

function downloadFile(name: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

interface TraceRow {
  key: string;
  label: string;
  preview: string;
  source_refs: string[];
}

function flattenBeats(script: Script): TraceRow[] {
  const rows: TraceRow[] = [];
  script.episodes.forEach((ep) =>
    ep.scenes.forEach((sc) =>
      sc.beats.forEach((b) => {
        const preview = b.type === "dialogue" ? `「${b.line}」` : b.type === "action" ? b.description : `→ ${b.transition_kind}`;
        rows.push({
          key: `${ep.episode_no}-${sc.scene_no}-${b.beat_no}`,
          label: `第${ep.episode_no}集 · 第${sc.scene_no}场 · beat${b.beat_no}「${b.type}」`,
          preview,
          source_refs: b.source_refs,
        });
      }),
    ),
  );
  return rows;
}

function sourceParagraphIds(parseResult: ParseResult | null): string[] {
  return parseResult?.source_paragraphs.map((p) => p.id) ?? [];
}

type StageKey = "source" | "parse" | "analyze" | "plan" | "script" | "storyboard";
type InspectorTab = "trace" | "quality" | "warnings" | "validation";

export default function WorkbenchPage() {
  const [novelText, setNovelText] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [plan, setPlan] = useState<PlanScenesResult | null>(null);
  const [yamlText, setYamlText] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [scriptJson, setScriptJson] = useState<Script | null>(null);
  const [traceParaIds, setTraceParaIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<StageKey>("source");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("trace");
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

  const beatRows = useMemo(() => (scriptJson ? flattenBeats(scriptJson) : []), [scriptJson]);
  const selectedParagraphs = useMemo(() => {
    if (!parseResult) return [];
    return traceParaIds
      .map((id) => parseResult.source_paragraphs.find((p) => p.id === id))
      .filter((p): p is SourceParagraph => Boolean(p));
  }, [parseResult, traceParaIds]);

  function resetDownstream() {
    setAnalysis(null);
    setPlan(null);
    setYamlText("");
    setValidation(null);
    setScriptJson(null);
    setTraceParaIds([]);
  }

  const txtInputRef = useRef<HTMLInputElement | null>(null);

  async function loadDemo() {
    setBusy("demo");
    try {
      const data = await getJson<{ text: string }>("/api/demo");
      setNovelText(data.text);
      setParseResult(null);
      resetDownstream();
      setActiveStage("source");
      setMessage({ type: "info", text: "已载入内置 Demo 小说" });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function loadTxtFile(file: File | null) {
    if (!file) return;
    const isTxt = file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt");
    if (!isTxt) {
      setMessage({ type: "error", text: "请上传 .txt 文本文件。" });
      return;
    }
    if (file.size > 1024 * 1024) {
      setMessage({ type: "error", text: "TXT 文件超过 1MB，请先截取 3 章左右文本再上传。" });
      return;
    }
    try {
      const text = (await file.text()).replace(/^\uFEFF/, "");
      setNovelText(text);
      setParseResult(null);
      resetDownstream();
      setActiveStage("source");
      setMessage({ type: "info", text: `已载入 TXT：${file.name}` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "TXT 读取失败。" });
    }
  }

  async function runParse() {
    setBusy("parse");
    try {
      const data = await postJson<ParseResult>("/api/parse", { text: novelText });
      // Only clear analysis/plan/YAML when the source actually changed (same fingerprint =
      // same text → keep the (possibly slow, live) downstream results instead of wiping them).
      const sourceChanged = data.source_fingerprint !== parseResult?.source_fingerprint;
      setParseResult(data);
      if (sourceChanged) resetDownstream();
      setActiveStage("parse");
      setMessage({
        type: data.checks.meets_minimum_chapters ? "info" : "error",
        text: data.checks.meets_minimum_chapters
          ? `解析完成：${data.stats.chapter_count} 章 / ${data.stats.paragraph_count} 段${data.warnings.length > 0 ? `，${data.warnings.length} 条提示` : ""}`
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
      setActiveStage("analyze");
      setPlan(null);
      setYamlText("");
      setValidation(null);
      setScriptJson(null);
      setTraceParaIds([]);
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
      setActiveStage("plan");
      setYamlText("");
      setValidation(null);
      setScriptJson(null);
      setTraceParaIds([]);
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
      setScriptJson(data.script_json);
      setActiveStage("script");
      setInspectorTab(data.validation_result.valid ? "quality" : "validation");
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
      setScriptJson(data.script ?? null);
      setActiveStage("script");
      setInspectorTab(data.valid ? "quality" : "validation");
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

  const parseState = parseResult ? (parseResult.checks.meets_minimum_chapters ? "done" : "warn") : "idle";
  const analysisCount = (analysis?.characters.length ?? 0) + (analysis?.locations.length ?? 0);
  const validationIssueCount = (validation?.errors.length ?? 0) + (validation?.warnings.length ?? 0);
  const stageItems: Array<{
    key: StageKey;
    title: string;
    description: string;
    meta: string;
    state: "idle" | "done" | "warn" | "locked";
    Icon: typeof FileText;
    disabled?: boolean;
  }> = [
    {
      key: "source",
      title: "原文输入",
      description: "粘贴或上传小说",
      meta: novelText.trim().length > 0 ? `${novelText.length} 字` : "等待文本",
      state: novelText.trim().length > 0 ? "done" : "idle",
      Icon: FileText,
    },
    {
      key: "parse",
      title: "解析",
      description: "章节 / 段落 / 指纹",
      meta: parseResult ? `${parseResult.stats.chapter_count} 章 · ${parseResult.stats.paragraph_count} 段` : "未运行",
      state: parseState,
      Icon: SearchCheck,
    },
    {
      key: "analyze",
      title: "分析",
      description: "人物 / 事件 / 冲突",
      meta: analysis ? `${analysisCount} 实体 · ${analysis.key_events.length} 事件` : "未运行",
      state: analysis ? "done" : "idle",
      Icon: ListChecks,
    },
    {
      key: "plan",
      title: "规划",
      description: "集 / 场 / 覆盖率",
      meta: plan ? `${plan.episodes.length} 集 · ${plan.scene_plan.length} 场` : "未运行",
      state: plan ? "done" : "idle",
      Icon: GitBranch,
    },
    {
      key: "script",
      title: "剧本",
      description: "YAML / 校验 / 导出",
      meta: validation ? (validation.valid ? "校验通过" : `${validationIssueCount} 个问题`) : yamlText ? "待校验" : "未生成",
      state: validation ? (validation.valid ? "done" : "warn") : yamlText ? "done" : "idle",
      Icon: Code2,
    },
    {
      key: "storyboard",
      title: "分镜",
      description: "Shot list 预留",
      meta: "下一阶段",
      state: "locked",
      Icon: Clapperboard,
      disabled: true,
    },
  ];
  const activeStageItem = stageItems.find((item) => item.key === activeStage) ?? stageItems[0]!;

  function renderSourceStage() {
    return (
      <div className="stage-grid source-stage">
        <div className="stage-toolbar">
          <input
            ref={txtInputRef}
            type="file"
            accept=".txt,text/plain"
            hidden
            onChange={(event) => {
              void loadTxtFile(event.target.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />
          <button className="btn" disabled={isBusy} onClick={() => txtInputRef.current?.click()}>
            <Upload size={15} />
            上传 TXT
          </button>
          <button className="btn" disabled={isBusy} onClick={loadDemo}>
            {spinner("demo", RefreshCw)}
            载入 Demo
          </button>
          <button className="btn primary" disabled={isBusy || novelText.trim().length === 0} onClick={runParse}>
            {spinner("parse", SearchCheck)}
            解析原文
          </button>
        </div>
        <textarea
          aria-label="小说原文"
          className="source-editor"
          placeholder="粘贴 3 章以上小说文本，或上传 UTF-8 TXT。解析后会生成稳定段落 ID 与原文指纹。"
          value={novelText}
          onChange={(event) => {
            setNovelText(event.target.value);
            setParseResult(null);
            resetDownstream();
          }}
        />
      </div>
    );
  }

  function renderParseStage() {
    if (!parseResult) {
      return (
        <div className="empty-state">
          <SearchCheck size={28} />
          <h3>还没有解析结果</h3>
          <p>先在原文输入阶段载入 3 章以上文本，再运行解析。</p>
          <button className="btn primary" disabled={isBusy || novelText.trim().length === 0} onClick={runParse}>
            {spinner("parse", SearchCheck)}
            解析原文
          </button>
        </div>
      );
    }

    return (
      <div className="stage-grid">
        <div className="summary-strip">
          <div><strong>{parseResult.stats.chapter_count}</strong><span>章节</span></div>
          <div><strong>{parseResult.stats.paragraph_count}</strong><span>段落</span></div>
          <div><strong>{parseResult.stats.character_count}</strong><span>字数</span></div>
          <div><strong>{parseResult.warnings.length}</strong><span>提示</span></div>
        </div>
        {parseResult.warnings.length > 0 ? (
          <div className="inline-findings">
            {parseResult.warnings.map((warning, index) => (
              <div className="finding warning" key={`${warning.code}-${warning.path ?? index}`}>
                <strong>{warning.code}</strong>
                <span>{warning.message}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="section-heading">
          <h3>原文段落</h3>
          <button className="btn" disabled={isBusy || !canRun} onClick={runAnalyze}>
            {spinner("analyze", ListChecks)}
            进入分析
          </button>
        </div>
        <div className="stage-list paragraph-list">
          {parseResult.source_paragraphs.map((p) => (
            <button
              className={`row-button${traceParaIds.includes(p.id) ? " trace" : ""}`}
              id={`para-${p.id}`}
              key={p.id}
              onClick={() => {
                setTraceParaIds([p.id]);
                setInspectorTab("trace");
              }}
            >
              <span className="row-title">
                <span>{p.chapter_id} / 第{p.paragraph_index}段</span>
                <span className="code">{p.id}</span>
              </span>
              <span className="row-text">{p.text ?? p.text_preview}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderAnalyzeStage() {
    if (!analysis) {
      return (
        <div className="empty-state">
          <ListChecks size={28} />
          <h3>等待分析</h3>
          <p>分析会抽取人物、地点、事件卡、冲突卡和钩子候选。</p>
          <button className="btn primary" disabled={isBusy || !canRun} onClick={runAnalyze}>
            {spinner("analyze", ListChecks)}
            开始分析
          </button>
        </div>
      );
    }

    return (
      <div className="stage-grid">
        <div className="summary-strip">
          <div><strong>{analysis.characters.length}</strong><span>人物</span></div>
          <div><strong>{analysis.locations.length}</strong><span>地点</span></div>
          <div><strong>{analysis.key_events.length}</strong><span>事件</span></div>
          <div><strong>{analysis.hook_candidates.length}</strong><span>钩子</span></div>
        </div>
        <div className="section-heading">
          <h3>人物与地点</h3>
          <button className="btn" disabled={isBusy || !analysis} onClick={runPlan}>
            {spinner("plan", GitBranch)}
            进入规划
          </button>
        </div>
        <div className="entity-grid">
          {[...analysis.characters, ...analysis.locations].map((item) => (
            <div className="data-card" key={item.id}>
              <div className="data-card-title">
                <strong>{item.name}</strong>
                <span className="code">{item.id}</span>
              </div>
              <p>{"motivation" in item ? item.motivation : item.description}</p>
            </div>
          ))}
        </div>
        <div className="section-heading">
          <h3>事件 · 冲突 · 钩子</h3>
        </div>
        <div className="stage-list">
          {analysis.key_events.map((event) => (
            <div className="data-row" key={event.id}>
              <div className="data-card-title">
                <strong>{event.summary}</strong>
                <span className="code">{event.id}</span>
              </div>
              <p>{event.dramatic_function} · {event.source_refs.join(", ")}</p>
            </div>
          ))}
          {analysis.conflicts.map((conflict) => (
            <div className="data-row" key={conflict.id}>
              <div className="data-card-title">
                <strong>{conflict.surface_conflict}</strong>
                <span className="code">{conflict.id}</span>
              </div>
              <p>{conflict.stakes}</p>
            </div>
          ))}
          {analysis.hook_candidates.map((hook) => (
            <div className="data-row" key={hook.id}>
              <div className="data-card-title">
                <strong>{hook.description}</strong>
                <span className="code">{hook.id}</span>
              </div>
              <p>{hook.why_it_hooks}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderPlanStage() {
    if (!plan) {
      return (
        <div className="empty-state">
          <GitBranch size={28} />
          <h3>等待规划</h3>
          <p>规划会把事件卡转成集目标、场景目的、冲突和情绪转折。</p>
          <button className="btn primary" disabled={isBusy || !analysis} onClick={runPlan}>
            {spinner("plan", GitBranch)}
            生成规划
          </button>
        </div>
      );
    }

    return (
      <div className="stage-grid">
        <div className="summary-strip">
          <div><strong>{plan.episodes.length}</strong><span>集</span></div>
          <div><strong>{plan.scene_plan.length}</strong><span>场</span></div>
          <div><strong>{Math.round(plan.coverage.coverage_ratio * 100)}%</strong><span>事件覆盖</span></div>
          <div><strong>{plan.pacing_notes.length}</strong><span>节奏提示</span></div>
        </div>
        <div className="section-heading">
          <h3>短剧集结构</h3>
          <button className="btn success" disabled={isBusy || !plan || !canRun} onClick={runGenerate}>
            {spinner("generate", Wand2)}
            生成剧本
          </button>
        </div>
        <div className="episode-strip">
          {plan.episodes.map((episode) => (
            <div className="episode-card" key={episode.episode_no}>
              <span>第{episode.episode_no}集</span>
              <strong>{episode.title}</strong>
              <p>{episode.opening_hook}</p>
            </div>
          ))}
        </div>
        <div className="section-heading">
          <h3>分场规划</h3>
        </div>
        <div className="stage-list">
          {plan.scene_plan.map((scene) => (
            <div className="data-row" key={`${scene.episode_no}-${scene.scene_no}`}>
              <div className="data-card-title">
                <strong>第{scene.episode_no}集 · 第{scene.scene_no}场</strong>
                <span className="code">{scene.location_id}</span>
              </div>
              <p>{scene.purpose}</p>
              <p>{scene.conflict} · {scene.emotional_shift}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderScriptStage() {
    return (
      <div className="stage-grid script-stage">
        <div className="stage-toolbar">
          <button className="btn success" disabled={isBusy || !plan || !canRun} onClick={runGenerate}>
            {spinner("generate", Wand2)}
            重新生成
          </button>
          <button className="btn primary" disabled={isBusy || yamlText.trim().length === 0} onClick={runValidate}>
            {spinner("validate", Play)}
            校验 YAML
          </button>
          <button className="btn" disabled={yamlText.trim().length === 0} onClick={() => downloadFile("script.yaml", yamlText)}>
            <Download size={15} />
            YAML
          </button>
          <button className="btn" disabled={!scriptJson} onClick={() => scriptJson && downloadFile("script.json", JSON.stringify(scriptJson, null, 2))}>
            <Download size={15} />
            JSON
          </button>
          <button className="btn" disabled={!scriptJson} onClick={() => scriptJson && downloadFile("adaptation-report.md", buildAdaptationReport(scriptJson))}>
            <Download size={15} />
            报告
          </button>
        </div>
        <div className="summary-strip">
          <div><strong>{scriptJson?.episodes.length ?? 0}</strong><span>集</span></div>
          <div><strong>{scriptJson?.episodes.reduce((sum, ep) => sum + ep.scenes.length, 0) ?? 0}</strong><span>场</span></div>
          <div><strong>{beatRows.length}</strong><span>beats</span></div>
          <div><strong>{quality ? `${Math.round(quality.source_coverage_ratio * 100)}%` : "--"}</strong><span>覆盖率</span></div>
        </div>
        <textarea
          aria-label="剧本 YAML"
          className="yaml-editor"
          placeholder="生成后这里会出现可编辑的 YAML 剧本，改完点“校验 YAML”。"
          value={yamlText}
          onChange={(event) => setYamlText(event.target.value)}
        />
      </div>
    );
  }

  function renderStoryboardStage() {
    return (
      <div className="empty-state">
        <Clapperboard size={28} />
        <h3>分镜阶段预留</h3>
        <p>这里后续可以承接 shot list、视频模型 prompt pack 和镜头级追溯。</p>
      </div>
    );
  }

  function renderStage() {
    if (activeStage === "source") return renderSourceStage();
    if (activeStage === "parse") return renderParseStage();
    if (activeStage === "analyze") return renderAnalyzeStage();
    if (activeStage === "plan") return renderPlanStage();
    if (activeStage === "script") return renderScriptStage();
    return renderStoryboardStage();
  }

  function renderTraceInspector() {
    return (
      <>
        <div className="inspector-block">
          <h3>当前追溯</h3>
          {traceParaIds.length > 0 ? (
            <div className="chips">
              {traceParaIds.map((id) => <span className="code chip" key={id}>{id}</span>)}
            </div>
          ) : (
            <p className="muted">点选段落或 beat 后，这里会显示对应原文。</p>
          )}
          {selectedParagraphs.map((p) => (
            <div className="trace-card" key={p.id}>
              <strong>{p.chapter_id} / 第{p.paragraph_index}段</strong>
              <p>{p.text ?? p.text_preview}</p>
            </div>
          ))}
        </div>
        <div className="inspector-block">
          <h3>Beat 列表</h3>
          {beatRows.length > 0 ? (
            <div className="compact-list">
              {beatRows.slice(0, 18).map((row) => {
                const hit = row.source_refs.some((ref) => traceParaIds.includes(ref));
                return (
                  <button
                    className={`compact-row${hit ? " trace" : ""}`}
                    key={row.key}
                    onClick={() => {
                      setTraceParaIds(row.source_refs);
                      setInspectorTab("trace");
                      const first = row.source_refs[0];
                      if (first) document.getElementById(`para-${first}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
                    }}
                  >
                    <strong>{row.label}</strong>
                    <span>{row.preview}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="muted">生成剧本后可查看 beat 与原文引用。</p>
          )}
        </div>
      </>
    );
  }

  function renderQualityInspector() {
    return (
      <div className="inspector-block">
        <h3>质量报告</h3>
        {quality ? (
          <>
            <div className="quality-grid">
              <div><strong>{Math.round(quality.source_coverage_ratio * 100)}%</strong><span>原文覆盖率</span></div>
              <div><strong>{quality.referenced_paragraph_count}/{quality.total_paragraph_count}</strong><span>引用段落</span></div>
              <div><strong>{quality.untraceable_scenes.length}</strong><span>无溯源场景</span></div>
            </div>
            {quality.manual_review_suggestions.length > 0 ? (
              <div className="compact-list">
                {quality.manual_review_suggestions.map((suggestion, index) => (
                  <div className="finding" key={index}>{suggestion}</div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">生成或校验后会显示覆盖率、引用段落和人工复核建议。</p>
        )}
      </div>
    );
  }

  function renderWarningsInspector() {
    const parseWarnings = parseResult?.warnings ?? [];
    const validationWarnings = validation?.warnings ?? [];
    const constraintWarnings = quality?.constraint_warnings ?? [];
    const hasWarnings = parseWarnings.length + validationWarnings.length + constraintWarnings.length + (analysis?.adaptation_warnings.length ?? 0) > 0;

    return (
      <div className="inspector-block">
        <h3>Warnings</h3>
        {hasWarnings ? (
          <div className="compact-list">
            {parseWarnings.map((warning, index) => (
              <div className="finding warning" key={`parse-${index}`}>
                <strong>{warning.code}</strong>
                <span>{warning.message}</span>
              </div>
            ))}
            {analysis?.adaptation_warnings.map((warning, index) => (
              <div className="finding warning" key={`analysis-${index}`}>{warning}</div>
            ))}
            {validationWarnings.map((warning, index) => (
              <div className="finding warning" key={`validation-${index}`}>
                <strong>{warning.code}</strong>
                <span className="code">{warning.path || "root"}</span>
                <div>{warning.message}</div>
              </div>
            ))}
            {constraintWarnings.map((warning, index) => (
              <div className="finding warning" key={`constraint-${index}`}>
                <strong>{warning.code}</strong>
                <span>{warning.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">暂无解析、改编或校验提示。</p>
        )}
      </div>
    );
  }

  function renderValidationInspector() {
    return (
      <div className="inspector-block">
        <h3>校验结果</h3>
        {validation && validation.errors.length + validation.warnings.length > 0 ? (
          <div className="compact-list">
            {validation.errors.map((item, index) => (
              <div className="finding error" key={`e-${index}`}>
                <strong>{item.code}</strong>
                <span className="code">{item.path || "root"}</span>
                <div>{item.message}</div>
              </div>
            ))}
            {validation.warnings.map((item, index) => (
              <div className="finding warning" key={`w-${index}`}>
                <strong>{item.code}</strong>
                <span className="code">{item.path || "root"}</span>
                <div>{item.message}</div>
              </div>
            ))}
          </div>
        ) : validation ? (
          <div className="finding success"><CheckCircle2 size={14} /> YAML 校验通过</div>
        ) : (
          <div className="finding"><AlertTriangle size={14} /> 尚无校验结果</div>
        )}
      </div>
    );
  }

  function renderInspector() {
    if (inspectorTab === "trace") return renderTraceInspector();
    if (inspectorTab === "quality") return renderQualityInspector();
    if (inspectorTab === "warnings") return renderWarningsInspector();
    return renderValidationInspector();
  }

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

      <section className="studio-layout">
        <aside className="pipeline-rail" aria-label="工作流步骤">
          <div className="rail-title">
            <span>Pipeline</span>
            <strong>{stageItems.filter((item) => item.state === "done").length}/5</strong>
          </div>
          <div className="rail-steps">
            {stageItems.map((item, index) => (
              <button
                className={`rail-step${activeStage === item.key ? " active" : ""}`}
                data-state={item.state}
                disabled={item.disabled}
                key={item.key}
                onClick={() => setActiveStage(item.key)}
              >
                <span className="step-index">{index + 1}</span>
                <span className="step-icon"><item.Icon size={16} /></span>
                <span className="step-copy">
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                  <em>{item.meta}</em>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="stage-panel" aria-label="当前工作区">
          <div className="stage-header">
            <div>
              <span className="eyebrow">Stage</span>
              <h2><activeStageItem.Icon size={18} /> {activeStageItem.title}</h2>
              <p>{activeStageItem.description}</p>
            </div>
            <span className={`stage-state ${activeStageItem.state}`}>{activeStageItem.meta}</span>
          </div>
          {message ? <div className={`message ${message.type}`} role={message.type === "error" ? "alert" : "status"}>{message.text}</div> : null}
          {parseResult?.checks.meets_minimum_chapters && parseResult.mode === "fixture" && !canUseFixture ? (
            <p className="hint">
              离线 Demo 模式：仅内置 Demo 可生成。自定义文本请配置 <code>OPENAI_API_KEY</code> 启用 live 模式。
            </p>
          ) : null}
          {parseResult?.checks.meets_minimum_chapters && parseResult.mode === "live" && !canUseFixture ? (
            <p className="hint">live 模式：将调用真实 LLM 生成（分析 → 规划 → 生成，可能需要数十秒）。</p>
          ) : null}
          <div className="stage-body">{renderStage()}</div>
        </section>

        <aside className="inspector-panel" aria-label="检查器">
          <div className="inspector-header">
            <div>
              <span className="eyebrow">Inspector</span>
              <h2>追溯与质量</h2>
            </div>
          </div>
          <div className="inspector-tabs" role="tablist" aria-label="检查器标签">
            <button className={inspectorTab === "trace" ? "active" : ""} onClick={() => setInspectorTab("trace")}>追溯</button>
            <button className={inspectorTab === "quality" ? "active" : ""} onClick={() => setInspectorTab("quality")}>质量</button>
            <button className={inspectorTab === "warnings" ? "active" : ""} onClick={() => setInspectorTab("warnings")}>Warnings</button>
            <button className={inspectorTab === "validation" ? "active" : ""} onClick={() => setInspectorTab("validation")}>校验</button>
          </div>
          <div className="inspector-body">{renderInspector()}</div>
        </aside>
      </section>
    </main>
  );
}
