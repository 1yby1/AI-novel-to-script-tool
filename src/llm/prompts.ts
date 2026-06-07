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
      content: `你是中文小说改编分析助手。基于带 ID 的原文段落，抽取：人物、地点、章节摘要、关键事件卡(key_events)、冲突卡(conflicts)、人物关系(relationship_edges)、开场钩子候选(hook_candidates)、改编提醒(adaptation_warnings)。${JSON_ONLY} 人物/地点用名字、不要编造 ID（系统会分配）。所有 source_refs（含事件/冲突/关系/钩子卡）只能引用下方列出的段落 ID。事件卡的 dramatic_function 必须取自：hook|setup|conflict|reversal|climax|resolution。`,
    },
    {
      role: "user",
      content: `原文段落（格式「ID: 正文」）：\n${paragraphCatalog(source)}\n\n输出 JSON：{"characters":[{"name":"","aliases":[],"role":"protagonist|antagonist|supporting|minor","motivation":"","relationship_notes":"","source_refs":[]}],"locations":[{"name":"","description":"","source_refs":[]}],"chapter_summaries":[{"chapter_id":"","summary":""}],"key_events":[{"id":"evt_1","summary":"","involved_character_names":[],"location_name":null,"dramatic_function":"hook","source_refs":[]}],"conflicts":[{"id":"conf_1","parties":[],"surface_conflict":"","underlying_tension":"","stakes":"","escalation":"","source_refs":[]}],"relationship_edges":[{"from_character_name":"","to_character_name":"","relation":"","tension":"","source_refs":[]}],"hook_candidates":[{"id":"hook_1","description":"","why_it_hooks":"","suggested_episode_no":1,"source_refs":[]}],"adaptation_warnings":[]}`,
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

export function buildEpisodeMessages(
  source: SourceContext,
  analysis: AnalyzeResult,
  plannedEpisode: PlanScenesResult["episodes"][number],
  plannedScenes: PlanScenesResult["scene_plan"],
): ChatMessage[] {
  return [
    {
      role: "system",
      content: `你是短剧编剧，只产出【第 ${plannedEpisode.episode_no} 集】这一集的剧本 JSON（创意部分）。${JSON_ONLY} 严格遵守：source_refs 只能引用合法段落 ID；character_id 与 present_character_ids 只能引用合法人物 ID；location_id 只能引用合法地点 ID；每个生成场景对应一条给定 scene_plan（scene_no/location_id/required_character_ids/source_refs 要一致）；beats 为有序数组，type 为 dialogue|action|transition，只含该类型字段。只输出这一集对象，不要顶层包装、不要其它集。`,
    },
    {
      role: "user",
      content: `合法段落 ID：${paragraphIdList(source)}\n合法人物 ID：${analysis.characters.map((c) => c.id).join(", ")}\n合法地点 ID：${analysis.locations.map((l) => l.id).join(", ")}\n\n本集规划（episode_no=${plannedEpisode.episode_no}）：${JSON.stringify(plannedEpisode)}\n本集分场规划：${JSON.stringify(plannedScenes)}\n约束：约 ${plannedEpisode.estimated_duration_seconds || 120}s、首集前 15 秒强钩子、结尾留悬念；每个 scene 与关键 beat 尽量带 source_refs。\n\n只输出第 ${plannedEpisode.episode_no} 集 JSON：{"episode_no":${plannedEpisode.episode_no},"title":"","opening_hook":"","core_conflict":"","cliffhanger":"","estimated_duration_seconds":120,"scenes":[{"scene_no":1,"heading":{"int_ext":"INT|EXT|INT_EXT","location_id":"","time_of_day":"DAY|NIGHT|DAWN|DUSK|CONTINUOUS"},"present_character_ids":[],"summary":"","beats":[],"source_refs":[]}]}`,
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
