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
function eventCatalog(analysis: AnalyzeResult): string {
  return analysis.key_events.map((e) => `${e.id}: ${e.summary}（${e.dramatic_function}）refs=${e.source_refs.join(",")}`).join("\n");
}
function conflictCatalog(analysis: AnalyzeResult): string {
  return analysis.conflicts.map((c) => `${c.id}: ${c.surface_conflict}; stakes=${c.stakes}; escalation=${c.escalation}`).join("\n");
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
      content: `你是短剧编剧。把小说改编为多集短剧结构：每集要有 main_goal（本集目标）、core_conflict、turning_point（转折）、cliffhanger（结尾悬念）；每个场景要有 purpose（目的）、conflict、emotional_shift（情绪变化）。${JSON_ONLY} location_id 只能用实体清单中的 ID；event_ids 只能引用下方关键事件 ID；required_character_ids 只能用人物 ID；source_refs 只能引用段落 ID。`,
    },
    {
      role: "user",
      content: `合法实体 ID：${entityCatalog(analysis)}\n合法段落 ID：${paragraphIdList(source)}\n\n关键事件：\n${eventCatalog(analysis)}\n\n冲突卡：\n${conflictCatalog(analysis)}\n\nhook_candidates（开场钩子候选）：\n${JSON.stringify(analysis.hook_candidates)}\n\n输出 JSON：{"episodes":[{"episode_no":1,"title":"","opening_hook":"","main_goal":"","core_conflict":"","turning_point":"","cliffhanger":"","estimated_duration_seconds":120,"event_ids":[],"source_refs":[]}],"scene_plan":[{"episode_no":1,"scene_no":1,"location_id":"","purpose":"","conflict":"","emotional_shift":"","required_character_ids":[],"event_ids":[],"source_refs":[],"summary":""}],"pacing_notes":[],"adaptation_strategy":""}`,
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
      content: `合法段落 ID：${paragraphIdList(source)}\n合法人物 ID：${analysis.characters.map((c) => c.id).join(", ")}\n合法地点 ID：${analysis.locations.map((l) => l.id).join(", ")}\n分集规划：${JSON.stringify(plan.episodes)}\n分场规划：${JSON.stringify(plan.scene_plan)}\n分集规划包含 main_goal / turning_point / event_ids / source_refs，生成时必须服务这些目标；分场规划包含 purpose / conflict / emotional_shift / required_character_ids / event_ids / source_refs，每个生成场景应对应一条 scene_plan。\n约束：短剧、每集约 120s、首集前 15 秒强钩子、每集结尾留悬念。\n\n（最终剧本顶层含 schema_version 等，但你只输出）JSON：{"episodes":[{"episode_no":1,"title":"","opening_hook":"","core_conflict":"","cliffhanger":"","estimated_duration_seconds":120,"scenes":[{"scene_no":1,"heading":{"int_ext":"INT|EXT|INT_EXT","location_id":"","time_of_day":"DAY|NIGHT|DAWN|DUSK|CONTINUOUS"},"present_character_ids":[],"summary":"","beats":[],"source_refs":[]}]}],"adaptation_notes":[{"type":"cut|merge|reorder|original_addition|pacing","description":"","source_refs":[]}]}`,
    },
  ];
}
