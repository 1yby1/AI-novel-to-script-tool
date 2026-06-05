# 剧本 YAML Schema 设计文档

> 适用范围：Novel2Script —— AI 小说转剧本工具的结构化输出格式。
> Schema 版本：`1.0`（对应 `schema_version: "1.0"`）。
> 实现源：`src/core/schema/script-schema.ts`（Zod v4）为本文档的唯一真实来源；本文与代码不一致时以代码为准。

---

## 1. 概述

本 Schema 定义"由小说自动改编而来的结构化剧本"的 YAML 表示。它不是单纯的文本剧本，而是一份**可编辑、可校验、可追溯**的工程化数据：

- **可编辑**：作者拿到的是结构化初稿，可逐场、逐 beat 修改后重新校验。
- **可校验**：每条引用、每项短剧约束都能被程序自动检查，而不是"相信模型"。
- **可追溯**：剧本里的每个场景、每句对白都能回指到原文的具体段落。

顶层是一个对象，固定包含以下 10 个区块：

```yaml
schema_version: "1.0"
metadata: { ... }                # 作品与生成元信息
adaptation_constraints: { ... }  # 改编约束（集数、时长、钩子、悬念、忠实度）
source_chapters: [ ... ]         # 来源章节（解析得到，章节摘要由分析阶段补全）
source_paragraphs: [ ... ]       # 来源段落 + 稳定 ID（可校验锚点集）
characters: [ ... ]              # 人物素材库（确定性 ID）
locations: [ ... ]               # 地点素材库（确定性 ID）
episodes: [ ... ]                # 剧本主体：集 → 场景 → beats
adaptation_notes: [ ... ]        # 改编说明（删减/合并/重排/原创/节奏）
quality_report: { ... }          # 质量报告（全部由系统计算）
```

---

## 2. 设计原则

1. **确定性内核与随机 LLM 解耦。** 凡是"可校验"的东西（ID、引用完整性、约束、覆盖率）都由确定性代码生成与检查；模型只负责创意改编，其产出必须通过校验闸门才能成为 YAML。
2. **引用而非复制。** 人物、地点、原文段落各有唯一 ID；剧本各处通过 ID 互相引用，校验器检查引用是否真实存在。
3. **由已校验 JSON 转 YAML。** YAML 不是模型直接吐出的，而是结构化 JSON 通过 Schema 校验后序列化得到，保证语法与结构始终合法。
4. **对作者宽容、对结构严格。** 容器对象允许作者添加未知字段（仅告警、不丢弃）；唯有 `beats` 这种判别式结构单元严格校验，因为越界字段几乎总是错误信号。

---

## 3. 字段定义

> 约定：下表"必填"列中，✅=必填，⭕=可选（`optional`）。容器对象（除 beats 外）均允许额外的未知字段（见 §5）。
>
> 关于"格式"：本 Schema 将段落 ID、实体 ID、`hash`、`created_at` 等一律按 `string` 校验；它们的**具体格式由生成器保证**，并由引用/锚定校验器核验**存在性与一致性**——Schema 本身**不做正则格式校验**。原因：关注点是"引用是否真实存在"而非"字符串是否符合某种格式"，这样手改后只要引用仍能解析即可通过，降低无谓的格式拒绝。

### 3.1 `schema_version`
固定字符串 `"1.0"`。用于未来 Schema 演进时的兼容判断。

### 3.2 `metadata`
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | ✅ | 作品标题 |
| `source_type` | `"novel"` | ✅ | 来源类型，当前固定为小说 |
| `target_format` | `"screenplay"` | ✅ | 目标类型，固定为剧本 |
| `adaptation_profile` | enum | ✅ | 改编档位：`short_drama` \| `film` \| `series` \| `custom` |
| `language` | string | ✅ | 语言标签，如 `zh-CN` |
| `created_at` | string | ✅ | 生成时间（ISO 8601 字符串） |
| `generator` | object | ✅ | 生成器信息，见下 |
| `source_fingerprint` | string | ✅ | 原文规范化指纹，用于锚定校验（见 §4.4） |

`generator`：
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | ✅ | 使用的模型名（fixture 模式下为 `fixture`） |
| `mode` | `"live"` \| `"fixture"` | ✅ | 生成模式：实时 LLM / 确定性 fixture |

### 3.3 `adaptation_constraints`
改编约束，写进 YAML 以便自动检查与作者调整。`adaptation_profile` 决定一组默认值，作者可覆盖。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `structure_unit` | `"episode"` \| `"act"` | ✅ | 顶层结构单元代表"集"还是"幕" |
| `episode_count` | int ≥ 1 | ✅ | 集/幕数量 |
| `target_duration_seconds_per_episode` | int ≥ 1 | ✅ | 每集目标时长（秒） |
| `opening_hook_required` | boolean | ✅ | 是否要求开场钩子 |
| `cliffhanger_required` | boolean | ✅ | 是否要求结尾悬念 |
| `fidelity_level` | `"faithful"` \| `"balanced"` \| `"creative"` | ✅ | 改编忠实度 |

**Profile 默认值**（`src/core/schema/profiles.ts`）：

| profile | structure_unit | episode_count | 时长/集(s) | opening_hook | cliffhanger | fidelity |
|---|---|---|---|---|---|---|
| **short_drama**（默认/主推） | episode | 3 | 120 | ✅ required | ✅ required | balanced |
| film | act | 3 | 1800 | optional | optional | balanced |
| series | episode | 6 | 1500 | required | optional | balanced |
| custom | episode | 3 | 120 | optional | optional | balanced |

`fidelity_level=balanced` 含义：保留主线与人物动机，允许压缩非核心情节、合并次要人物、重排部分情节，但不改变核心人物关系与主要冲突方向。

### 3.4 `source_chapters[]`
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ | 章节 ID，如 `ch1` |
| `title` | string | ✅ | 章节标题（标记后剩余文本；无则回退 `第N章`） |
| `index` | int ≥ 1 | ✅ | 章节序号，从 1 起 |
| `summary` | string | ✅ | 章节摘要（章节由解析得到；摘要在分析阶段补全，最终 YAML 中必填） |

### 3.5 `source_paragraphs[]` —— 可校验锚点集
原文段落及其稳定 ID。剧本所有 `source_refs` 只能引用这里存在的 `id`。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ | 稳定段落 ID，格式 `ch{c}_p{p}_{hash8}` |
| `chapter_id` | string | ✅ | 所属章节 ID |
| `paragraph_index` | int ≥ 1 | ✅ | 章节内段落序号，从 1 起 |
| `text_preview` | string | ✅ | 段落预览（截断展示用） |
| `hash` | string | ✅ | 规范化段落文本的 8 位 hash |

**段落 ID 规则**：`ch{chapterNo}_p{paragraphNo}_{hash8}`，例如 `ch1_p3_a1b2c3d4`。
- `hash8` = 段落文本规范化后 SHA-256 的前 8 位十六进制。
- 规范化：统一换行（CRLF/CR→LF）、合并连续空白（含全角空格、换行）为单个空格、去首尾空白；中文标点与正文内容保持不变。
- 因此：同一段文本重复解析得到相同 ID；缩进/换行/重复空格等排版差异不影响 ID。

> 注意：YAML 中的 `source_paragraphs` **不包含**段落全文，只保留 `text_preview` 与 `hash`，以控制 YAML 体积；全文仅在生成管线内存中使用。

### 3.6 `characters[]`
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ | 确定性人物 ID，格式 `char_{slug}_{hash6}` 或 `char_{hash6}` |
| `name` | string | ✅ | 人物名 |
| `aliases` | string[] | ✅ | 别名（可为空数组） |
| `role` | enum | ✅ | `protagonist` \| `antagonist` \| `supporting` \| `minor` |
| `motivation` | string | ✅ | 人物动机 |
| `relationship_notes` | string | ✅ | 关系备注 |
| `source_refs` | string[] | ✅ | 该人物的原文出处（段落 ID 列表） |

### 3.7 `locations[]`
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ | 确定性地点 ID，格式 `loc_{slug}_{hash6}` 或 `loc_{hash6}` |
| `name` | string | ✅ | 地点名 |
| `description` | string | ✅ | 地点描述 |
| `source_refs` | string[] | ✅ | 原文出处 |

> **实体 ID 规则**：`{prefix}_{slug}_{hash6}`。`hash6` = 规范化人物/地点名（去空白+小写）SHA-256 前 6 位；`slug` 为名称中的 ASCII 字母数字（中文名为空则省略 slug）。由系统按名称生成，保证同名稳定、不同名区分，不由模型自由编造。

### 3.8 `episodes[]` —— 剧本主体
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `episode_no` | int ≥ 1 | ✅ | 集序号 |
| `title` | string | ✅ | 集标题 |
| `opening_hook` | string | ✅ | 开场钩子（前 ~15 秒强钩子） |
| `core_conflict` | string | ✅ | 本集核心冲突 |
| `cliffhanger` | string | ✅ | 结尾悬念/未完成冲突 |
| `estimated_duration_seconds` | int ≥ 1 | ✅ | 本集预估时长 |
| `scenes` | Scene[] | ✅ | 分场列表 |

### 3.9 `scenes[]`
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `scene_no` | int ≥ 1 | ✅ | 场序号 |
| `heading` | object | ✅ | 场景标题（slug line）部件，见下 |
| `present_character_ids` | string[] | ✅ | 在场人物（character_id 引用） |
| `summary` | string | ✅ | 场景摘要 |
| `beats` | Beat[] | ✅ | **单一有序** beat 列表，见 §3.10 |
| `source_refs` | string[] | ✅ | 场景级原文出处 |

`heading`：
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `int_ext` | `"INT"` \| `"EXT"` \| `"INT_EXT"` | ✅ | 内景/外景/内外景 |
| `location_id` | string | ✅ | 地点引用（location_id） |
| `time_of_day` | enum | ✅ | `DAY` \| `NIGHT` \| `DAWN` \| `DUSK` \| `CONTINUOUS` |

### 3.10 `beats[]` —— 单一有序、按 `type` 判别
一个场景的内容是**一个有序的 beat 列表**，每个 beat 按 `type` 取不同字段。这是 Schema 中唯一**严格**校验的结构（多余/越界字段直接报错）。三种 type：

**dialogue（对白）**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `beat_no` | int ≥ 1 | ✅ | beat 序号 |
| `type` | `"dialogue"` | ✅ | 判别值 |
| `source_refs` | string[] | ✅ | beat 级原文出处 |
| `character_id` | string | ✅ | 说话人（character_id 引用） |
| `line` | string | ✅ | 台词 |
| `parenthetical` | string | ⭕ | 表演提示（如"低声"） |

**action（动作/叙述）**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `beat_no` | int ≥ 1 | ✅ | beat 序号 |
| `type` | `"action"` | ✅ | 判别值 |
| `source_refs` | string[] | ✅ | beat 级原文出处 |
| `description` | string | ✅ | 动作/场面描述 |

**transition（转场）**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `beat_no` | int ≥ 1 | ✅ | beat 序号 |
| `type` | `"transition"` | ✅ | 判别值 |
| `source_refs` | string[] | ✅ | 可为空数组 |
| `transition_kind` | enum | ✅ | `CUT_TO` \| `FADE_OUT` \| `FADE_IN` \| `DISSOLVE_TO` \| `SMASH_CUT` |

### 3.11 `adaptation_notes[]`
记录 AI 的改编选择，让作者理解"为什么这样改"。
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | enum | ✅ | `cut`（删减）\| `merge`（合并）\| `reorder`（重排）\| `original_addition`（原创补充）\| `pacing`（节奏调整） |
| `description` | string | ✅ | 说明 |
| `source_refs` | string[] | ⭕ | 相关原文出处 |

### 3.12 `quality_report` —— 全部由系统计算
不接受模型/用户填写，每次校验时**重算**并以重算值为准。重新校验作者编辑过的 YAML 时，系统**忽略**其中的 `quality_report` 并重算注入——因此即使作者删除或改动本块，也不会因"缺失/不符"产生结构错误（始终以系统重算结果为准）。
| 字段 | 类型 | 说明 |
|---|---|---|
| `source_coverage_ratio` | number 0..1 | 被引用的去重段落数 / 总段落数 |
| `referenced_paragraph_count` | int ≥ 0 | 被引用的去重合法段落数 |
| `total_paragraph_count` | int ≥ 0 | 原文段落总数 |
| `missing_source_refs` | string[] | 引用了但不存在的 ID（修复后应为空） |
| `repaired_refs` | string[] | 生成阶段被自动剔除的非法引用 |
| `untraceable_scenes` | string[] | 溯源为空的场景（`episodes[i].scenes[j]`） |
| `unreferenced_key_paragraphs` | string[] | 重要却未被引用的段落（启发式，best-effort） |
| `constraint_warnings` | {code,message}[] | 约束告警 |
| `manual_review_suggestions` | string[] | 可读的人工复核建议 |

---

## 4. 引用与完整性

### 4.1 `source_refs`（段落引用）
出现在 character / location / scene / beat / adaptation_note 上，元素必须是 `source_paragraphs[].id` 中真实存在的 ID。引用不存在 → `INVALID_SOURCE_REF`。

### 4.2 `character_id` 引用
`scene.present_character_ids[]` 与 `dialogue beat.character_id` 必须指向真实存在的 `characters[].id`。否则 `INVALID_CHARACTER_REF`。

### 4.3 `location_id` 引用
`scene.heading.location_id` 必须指向真实存在的 `locations[].id`。否则 `INVALID_LOCATION_REF`。

### 4.4 `source_fingerprint`（防伪造源）
引用完整性不能只在 YAML 内部自洽——否则作者伪造一份 `source_paragraphs` 即可绕过。因此校验时以**原始解析结果**为准：携带解析阶段的 canonical 段落 ID 集 / 指纹时，校验 YAML 的 `source_paragraphs` 与 `source_refs` 必须是 canonical 的子集，且 `metadata.source_fingerprint` 与 canonical 一致；不一致 → `SOURCE_MISMATCH`。脱离上下文时退化为内部一致性校验并给出 `SOURCE_UNVERIFIED` 告警。

### 4.5 `chapter_id` 引用（段落 → 章节）
`source_paragraphs[].chapter_id` 必须指向真实存在的 `source_chapters[].id`。生成器按解析结果保证；脱离上下文的手改 YAML 由校验器核验，缺失目标章节 → `INVALID_CHAPTER_REF`。

### 4.6 唯一性与序号
- 各类 `id`（段落、人物、地点）在各自集合内应**唯一**：段落 ID 由"位置 + 内容 hash"构造、人物/地点 ID 由名称派生去重，生成器即保证唯一；手改后由校验器核验。
- `episode_no` / `scene_no` / `beat_no` 在其父级内应**唯一且自 1 连续递增**。生成器按序产出；校验器核验唯一性，连续性缺口以告警（不阻断）提示，便于作者察觉漏删/错位。

---

## 5. 宽严策略与错误模型

**对作者宽容、对结构严格：**
- **容器对象**（metadata / adaptation_constraints / source_* / characters / locations / episodes / scenes / heading / adaptation_notes / quality_report）：保留未知键、不丢弃、不硬失败，仅产出 `UNKNOWN_FIELD` 告警——保护作者的手写注记。
- **beats**：唯一严格例外。缺必填、类型/枚举错误、出现不属于该 `type` 的字段，一律 `SCHEMA_ERROR`。因为 beat 是判别式结构单元，越界字段几乎总是"`type` 设错或残留旧字段"的信号，硬报错比静默告警更有助于作者修正。

**错误对象**统一形如：
```json
{ "path": "episodes[1].scenes[0].beats[3].source_refs[2]",
  "code": "INVALID_SOURCE_REF",
  "message": "source_ref 不存在：ch9_p1_zzzzzzzz" }
```
- **硬错误（阻断）**：`YAML_SYNTAX_ERROR` · `SCHEMA_ERROR` · `INVALID_SOURCE_REF` · `INVALID_CHARACTER_REF` · `INVALID_LOCATION_REF` · `INVALID_CHAPTER_REF` · `SOURCE_MISMATCH` · `CONSTRAINT_VIOLATION`
- **告警（不阻断）**：`UNKNOWN_FIELD` · `SOURCE_UNVERIFIED` · `WEAK_TRACEABILITY` · `CONSTRAINT_WARNING`

**生成 vs 手改两条路径**：生成阶段对非法 `source_ref` **自动剔除**并记入 `repaired_refs`，保证总能产出可用初稿；作者手改后的 YAML 重新校验时则**硬报错**并给出精确路径。

---

## 6. 设计原因（Schema 为什么这样设计）

1. **为什么需要稳定段落 ID + 可校验 `source_refs`。** 这是"非套壳"的核心。让剧本内容可追溯到原文、防止模型编造引用、使自动校验与人工审查成为可能。ID 由确定性算法生成（内容 hash + 位置），重复解析稳定、排版差异不敏感。

2. **为什么人物/地点也用确定性 ID 而非模型自由命名。** 若 ID 由模型自由生成，多阶段管线里 `character_id`/`location_id` 引用会不稳定、易错。系统按名称派生 ID（同名稳定、可去重），让"引用完整性"成为贯穿全 Schema 的统一主线。

3. **为什么把改编约束写进 YAML（`adaptation_constraints`）。** 集数、时长、开场钩子、结尾悬念是短剧改编质量的关键。写进 YAML 后既能被程序自动检查，又方便作者直接调整档位。

4. **为什么用 `episodes → scenes → 单一有序 beats`。** 影视/短剧天然以集、场组织；用一个**有序** beat 列表（每个 beat 带 type）表达剧情节奏，对白与动作的先后顺序天然明确，比"对白、动作各开一个并行数组"更贴近真实剧本、更易渲染与编辑。

5. **为什么是"通用剧本 + 短剧 preset"而非写死短剧。** 题目要求的是通用"剧本"。Schema 用通用结构（集/幕-场景-beat）承载，把集数/时长/钩子/悬念做成可配置的 `adaptation_constraints`，短剧只是默认 profile。这样既满足通用性，又能用短剧 preset 出彩演示。v1 仅用 `episodes[]` 一个结构容器，`structure_unit` 说明它代表"集"还是"幕"（电影设 `episode_count: 1` 或按三幕）——以一个容器换取 Schema 简洁与校验统一，是刻意取舍。

6. **为什么容器宽松、beats 严格。** 见 §5。编辑体验要宽容（别因为一个无关字段就拒绝作者），但结构核心要严格（beat 的越界字段是真错误）。

7. **为什么由已校验 JSON 转 YAML，而非让模型直接吐 YAML。** 模型直出 YAML 容易语法错、结构漂移。先生成 JSON、过 Schema 与引用校验，再序列化为 YAML，保证输出始终合法、可控。

8. **为什么 `quality_report` 全部由系统计算。** 让输出不只是剧本，还带可量化、可信赖的反馈（覆盖率、缺失引用、约束告警、溯源薄弱场景）。它必须由确定性代码算出、每次重算，而不是相信模型或用户填写的值——这才是"可验证"而非"自说自话"。

9. **为什么保留 `adaptation_notes`。** 改编不是逐字转换，会删减、合并、重排、原创补充。显式记录这些选择，让作者理解 AI 的改编逻辑，也便于评审。

10. **为什么有 `schema_version`。** 为未来字段演进留出兼容判断的锚点。

---

## 7. 完整示例

```yaml
schema_version: "1.0"
metadata:
  title: 雾港旧约
  source_type: novel
  target_format: screenplay
  adaptation_profile: short_drama
  language: zh-CN
  created_at: "2026-06-05T00:00:00Z"
  generator: { model: gpt-4o-mini, mode: live }
  source_fingerprint: a1b2c3d4e5f6a7b8
adaptation_constraints:
  structure_unit: episode
  episode_count: 3
  target_duration_seconds_per_episode: 120
  opening_hook_required: true
  cliffhanger_required: true
  fidelity_level: balanced
source_chapters:
  - { id: ch1, title: 归港, index: 1, summary: 林深三年后回到旧码头。 }
source_paragraphs:
  - { id: ch1_p1_a1b2c3d4, chapter_id: ch1, paragraph_index: 1, text_preview: 林深回到了旧码头。, hash: a1b2c3d4 }
  - { id: ch1_p2_e5f6a7b8, chapter_id: ch1, paragraph_index: 2, text_preview: 海风很冷，灯塔还亮着。, hash: e5f6a7b8 }
characters:
  - id: char_3f9a1b
    name: 林深
    aliases: [老林]
    role: protagonist
    motivation: 查清父亲沉船的真相
    relationship_notes: 与灯塔看守人苏晚旧识
    source_refs: [ch1_p1_a1b2c3d4]
locations:
  - { id: loc_77c2e1, name: 旧码头, description: 雾气弥漫的废弃码头, source_refs: [ch1_p1_a1b2c3d4] }
episodes:
  - episode_no: 1
    title: 归来
    opening_hook: 三年后，林深踩着碎浪回到本该埋葬他的码头。
    core_conflict: 林深想查真相，码头却无人愿意提起那夜。
    cliffhanger: 灯塔的灯，在他靠近时忽然熄灭。
    estimated_duration_seconds: 120
    scenes:
      - scene_no: 1
        heading: { int_ext: EXT, location_id: loc_77c2e1, time_of_day: NIGHT }
        present_character_ids: [char_3f9a1b]
        summary: 林深独自登岸，旧码头一如三年前。
        beats:
          - { beat_no: 1, type: action, description: 林深踏上湿滑的栈桥，海风灌进衣领。, source_refs: [ch1_p1_a1b2c3d4] }
          - { beat_no: 2, type: dialogue, character_id: char_3f9a1b, parenthetical: 低声, line: 三年了。, source_refs: [ch1_p2_e5f6a7b8] }
          - { beat_no: 3, type: transition, transition_kind: CUT_TO, source_refs: [] }
        source_refs: [ch1_p1_a1b2c3d4, ch1_p2_e5f6a7b8]
adaptation_notes:
  - { type: merge, description: 将原文多名码头工人合并为一名旁观者以聚焦主线。, source_refs: [ch1_p2_e5f6a7b8] }
quality_report:
  source_coverage_ratio: 1.0
  referenced_paragraph_count: 2
  total_paragraph_count: 2
  missing_source_refs: []
  repaired_refs: []
  untraceable_scenes: []
  unreferenced_key_paragraphs: []
  constraint_warnings: []
  manual_review_suggestions: []
```

---

## 8. 版本与演进

- 当前 `schema_version: "1.0"`。
- 破坏性变更（删字段、改类型/枚举语义）将提升主版本；新增可选字段属向后兼容。
- 由于容器对象采用"未知字段告警而非拒绝"的策略，旧工具读取含新增字段的 YAML 时不会硬失败，只提示未知字段，便于平滑演进。
