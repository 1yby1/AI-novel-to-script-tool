import type { ChatMessage } from "./json-llm";
import type { AnalyzeResult, PlanScenesResult, SourceContext } from "./provider";

const JSON_ONLY = "只返回一个合法 json 对象（JSON 格式），不要 markdown 围栏、不要任何解释文字。";

function paragraphCatalog(source: SourceContext): string {
  return (source.source_paragraphs ?? []).map((p) => `${p.id}: ${p.text}`).join("\n");
}
function paragraphIdList(source: SourceContext): string {
  return (source.source_paragraphs ?? []).map((p) => p.id).join(", ");
}
function entityCatalog(analysis: AnalyzeResult): string {
  return [
    ...analysis.characters.map((c) => `${c.id}=${c.name}`),
    ...analysis.locations.map((l) => `${l.id}=${l.name}`),
  ].join(", ");
}

export function buildAnalyzeMessages(source: SourceContext): ChatMessage[] {
  return [
    {
      role: "system",
      content: `你是中文小说改编分析助手。基于带 ID 的原文段落，抽取人物、地点、章节摘要、关键事件、主要冲突。${JSON_ONLY} 人物/地点不要编造 ID（系统会分配）。source_refs 只能引用下方列出的段落 ID。`,
    },
    {
      role: "user",
      content: `原文段落（格式「ID: 正文」）：\n${paragraphCatalog(source)}\n\n输出 JSON：{"characters":[{"name":"","aliases":[],"role":"protagonist|antagonist|supporting|minor","motivation":"","relationship_notes":"","source_refs":[]}],"locations":[{"name":"","description":"","source_refs":[]}],"chapter_summaries":[{"chapter_id":"","summary":""}],"key_events":[],"conflicts":[]}`,
    },
  ];
}

export function buildPlanMessages(source: SourceContext, analysis: AnalyzeResult): ChatMessage[] {
  return [
    {
      role: "system",
      content: `你是短剧编剧。把小说改编为多集短剧结构，每集包含开场钩子、核心冲突、结尾悬念。${JSON_ONLY} location_id 只能用下方实体清单中的 ID。`,
    },
    {
      role: "user",
      content: `合法实体 ID：${entityCatalog(analysis)}\n合法段落 ID：${paragraphIdList(source)}\n章节摘要：${analysis.chapter_summaries.map((s) => `${s.chapter_id}:${s.summary}`).join(" | ")}\n\n输出 JSON：{"episodes":[{"episode_no":1,"title":"","opening_hook":"","core_conflict":"","cliffhanger":"","estimated_duration_seconds":120,"scene_refs":[]}],"scene_plan":[{"episode_no":1,"scene_no":1,"location_id":"","summary":""}],"pacing_notes":[],"adaptation_strategy":""}`,
    },
  ];
}

export function buildGenerateMessages(source: SourceContext, analysis: AnalyzeResult, plan: PlanScenesResult): ChatMessage[] {
  return [
    {
      role: "system",
      content: `你是短剧编剧，产出结构化剧本的【创意部分】 JSON。${JSON_ONLY} 严格遵守：source_refs 只能引用合法段落 ID；character_id 只能引用合法人物 ID；location_id 只能引用合法地点 ID；beats 为有序数组，每个 beat 的 type 为 dialogue|action|transition，且只包含该类型字段：dialogue={beat_no,type,source_refs,character_id,line,parenthetical?}；action={beat_no,type,source_refs,description}；transition={beat_no,type,source_refs,transition_kind}。系统会补全 metadata/source_paragraphs/quality_report 等，你只需产出 episodes 与 adaptation_notes。`,
    },
    {
      role: "user",
      content: `合法段落 ID：${paragraphIdList(source)}\n合法人物 ID：${analysis.characters.map((c) => c.id).join(", ")}\n合法地点 ID：${analysis.locations.map((l) => l.id).join(", ")}\n分集规划：${JSON.stringify(plan.episodes)}\n分场规划：${JSON.stringify(plan.scene_plan)}\n约束：短剧、每集约 120s、首集前 15 秒强钩子、每集结尾留悬念。\n\n（最终剧本顶层含 schema_version 等，但你只输出）JSON：{"episodes":[{"episode_no":1,"title":"","opening_hook":"","core_conflict":"","cliffhanger":"","estimated_duration_seconds":120,"scenes":[{"scene_no":1,"heading":{"int_ext":"INT|EXT|INT_EXT","location_id":"","time_of_day":"DAY|NIGHT|DAWN|DUSK|CONTINUOUS"},"present_character_ids":[],"summary":"","beats":[],"source_refs":[]}]}],"adaptation_notes":[{"type":"cut|merge|reorder|original_addition|pacing","description":"","source_refs":[]}]}`,
    },
  ];
}
