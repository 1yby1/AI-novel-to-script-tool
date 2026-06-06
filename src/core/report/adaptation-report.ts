import type { Script } from "../schema/script-schema";

const NOTE_LABELS: Record<string, string> = {
  cut: "删减",
  merge: "合并",
  reorder: "重排",
  original_addition: "原创补充",
  pacing: "节奏调整",
};

function countWithList(count: number, items: ReadonlyArray<string>): string {
  return items.length > 0 ? `${count} 个（${items.join("、")}）` : `${count} 个`;
}

function bulletsOrNone(items: ReadonlyArray<string>): string {
  return items.length > 0 ? items.map((x) => `- ${x}`).join("\n") : "（无）";
}

/**
 * Build a human-readable Markdown adaptation report from a (validated) script.
 * Deterministic — reads only the script's own fields (incl. the recomputed quality_report),
 * never calls a model. Used by the workbench "下载改编报告" export.
 */
export function buildAdaptationReport(script: Script): string {
  const m = script.metadata;
  const c = script.adaptation_constraints;
  const q = script.quality_report;
  const lines: string[] = [];

  lines.push(`# 改编报告 · ${m.title}`, "");
  lines.push(`- 生成模式：${m.generator.mode}（模型 ${m.generator.model}）`);
  lines.push(`- 生成时间：${m.created_at}`);
  lines.push(`- 改编档位：${m.adaptation_profile}`, "");

  lines.push("## 改编约束");
  lines.push(`- 结构单元：${c.structure_unit}`);
  lines.push(`- 集数：${c.episode_count}`);
  lines.push(`- 每集目标时长：${c.target_duration_seconds_per_episode}s`);
  lines.push(`- 开场钩子：${c.opening_hook_required ? "要求" : "不要求"}`);
  lines.push(`- 结尾悬念：${c.cliffhanger_required ? "要求" : "不要求"}`);
  lines.push(`- 忠实度：${c.fidelity_level}`, "");

  lines.push("## 原文覆盖与溯源");
  lines.push(`- 覆盖率：${Math.round(q.source_coverage_ratio * 100)}%（被引用 ${q.referenced_paragraph_count}/${q.total_paragraph_count} 段）`);
  lines.push(`- 无效引用：${countWithList(q.missing_source_refs.length, q.missing_source_refs)}`);
  lines.push(`- 自动剔除引用：${countWithList(q.repaired_refs.length, q.repaired_refs)}`);
  lines.push(`- 弱溯源场景：${countWithList(q.untraceable_scenes.length, q.untraceable_scenes)}`, "");

  lines.push("## 改编说明");
  if (script.adaptation_notes.length === 0) {
    lines.push("（无）");
  } else {
    for (const note of script.adaptation_notes) {
      lines.push(`- [${NOTE_LABELS[note.type] ?? note.type}] ${note.description}`);
    }
  }
  lines.push("");

  lines.push("## 分集概览");
  for (const ep of script.episodes) {
    lines.push(`### 第${ep.episode_no}集 · ${ep.title}（约 ${ep.estimated_duration_seconds}s，${ep.scenes.length} 场）`);
    lines.push(`- 开场钩子：${ep.opening_hook}`);
    lines.push(`- 核心冲突：${ep.core_conflict}`);
    lines.push(`- 结尾悬念：${ep.cliffhanger}`, "");
  }

  lines.push("## 人工复核建议");
  lines.push(bulletsOrNone(q.manual_review_suggestions), "");

  return lines.join("\n");
}
