# Novel2Script 设计文档（Design Spec）

> 笔试题目三：AI 小说转剧本工具
> 状态：已通过 brainstorming 对齐；已吸收外部评审，迭代至 **v1.1**；待用户复核
> 日期：2026-06-05
> 关联：根方案见 [PROJECT_PLAN_FOR_AI.md](../../../PROJECT_PLAN_FOR_AI.md)；Schema 设计原因详见 `docs/script-yaml-schema.md`（实现阶段产出）
> 变更记录：v1.1 吸收外部评审 7 条（详见 §21），核心为「校验锚定 canonical 源、quality_report 重算、实体 ID 确定性化、宽严策略统一、溯源最低门槛、fixture 范围澄清、合规计划」。

---

## 1. 概述与目标

**Novel2Script** 是一个本地可运行的 Web 工作台，帮助小说作者把 **3 个章节以上**的中文小说文本自动改编成**结构化剧本**，以 **YAML** 输出，并保证产物**可追溯、可校验、可编辑**。

核心理念：把系统拆成**确定性内核**（可证明正确）与**随机 LLM 层**（可替换）。所有"可校验"的能力——稳定段落 ID、实体 ID、引用完整性、约束检查、质量报告——都落在确定性内核，由代码计算得出；LLM 只负责创意改编，其产出必须通过内核闸门才能成为最终 YAML。这是本项目区别于"Prompt 套壳"的工程主线。

非目标（v1 不做）：登录系统、数据库、多用户协作、DOCX/PDF 解析、强云端依赖、复杂剧本专业排版、多语言输入输出。

---

## 2. 交付物

| # | 交付物 | 对应题目要求 |
|---|---|---|
| D1 | 转换工具：解析→分析→归一→规划→生成→校验 的 pipeline，产出剧本 YAML | "自动转换为结构化剧本（YAML）" |
| D2 | `docs/script-yaml-schema.md`：Schema 定义 + **设计原因** | "额外写一篇文档，定义剧本 YAML Schema，说明设计原因" |
| D3 | 工作台 UI：输入 → 流程 → 中间结果 → YAML 编辑/重校验 → 导出 | "可编辑、可进一步打磨的剧本初稿" |
| D4 | 原创三章 Demo 小说 + 已校验 fixtures（兼测试数据，规避版权） | 评委一键体验 |
| D5 | 确定性内核单元测试 + fixture 全链路集成测试 | 工程可信度 |
| D6 | README、`.env.example` | 可复现、不泄密 |

---

## 3. 总体架构（分层）

| 层 | 职责 | 是否依赖 AI |
|---|---|---|
| **确定性内核** `src/core` | 章节/段落解析 + 稳定 ID；实体归一化 + 实体 ID；Zod Schema & 类型；校验器（schema / 引用完整性 / 约束 / 锚定）；quality_report 计算；JSON↔YAML 转换 | ❌ 纯函数，可单测，CI 不触网 |
| **LLM 适配层** `src/llm` | OpenAI 兼容 client；analyze→plan→generate 三阶段 Prompt；`ScriptProvider` 接口，两实现：`LiveLLMProvider` / `FixtureProvider` | ✅ 可被 fixture 替换 |
| **API 路由** `src/app/api` | Next.js Route Handlers，编排内核与 LLM 层 | 透传 |
| **工作台 UI** `src/app` | 输入、流程展示、中间结果、YAML 编辑与重校验、导出 | 调 API |

**关键依赖方向**：UI → API → (LLM 适配层 + 确定性内核)；确定性内核**不依赖**任何上层，也不依赖 AI，可独立编译与测试。

---

## 4. 目录结构

```
aitransfer/
├─ PROJECT_PLAN_FOR_AI.md          # 既有根方案
├─ README.md
├─ .env.example                    # 只示例，不含真实 Key
├─ .gitignore
├─ package.json
├─ docs/
│  ├─ script-yaml-schema.md        # ★ D2：Schema 定义 + 设计原因
│  └─ superpowers/specs/2026-06-05-novel2script-design.md   # 本文件
├─ src/
│  ├─ core/                        # 确定性内核（无 AI）
│  │  ├─ parse/ { normalize.ts, chapters.ts, paragraph-id.ts }
│  │  ├─ entities/ { normalize-entities.ts, entity-id.ts }   # 实体归一化 + 确定性 ID
│  │  ├─ schema/ { script-schema.ts, types.ts, profiles.ts }
│  │  ├─ validate/ { schema-validate.ts, referential.ts, constraints.ts, anchor.ts, quality-report.ts }
│  │  └─ yaml/ { convert.ts, fingerprint.ts }
│  ├─ llm/                         # LLM 适配层
│  │  ├─ provider.ts               # ScriptProvider 接口
│  │  ├─ live-provider.ts
│  │  ├─ fixture-provider.ts
│  │  ├─ client.ts                 # OpenAI 兼容
│  │  └─ prompts/ { analyze.ts, plan.ts, generate.ts }
│  └─ app/
│     ├─ api/{parse,analyze,plan-scenes,generate-script,validate-yaml}/route.ts
│     ├─ page.tsx                  # 工作台
│     └─ components/...
├─ fixtures/
│  ├─ demo-novel.txt               # 原创三章
│  ├─ demo-analysis.json
│  ├─ demo-plan.json
│  ├─ demo-script.json
│  └─ demo-script.yaml
└─ tests/
   ├─ core/*.test.ts
   └─ integration/pipeline.test.ts
```

---

## 5. YAML Schema 完整定义（v1.0）

通用剧本结构；短剧只是默认 profile。场景内部用**单一有序 `beats`**；角色 / 地点 / 段落**全部 ID 引用**并接受引用完整性校验。**所有 ID（段落与实体）均由确定性内核生成，模型不自由编造**（见 §6）。

### 5.1 顶层

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `schema_version` | string | ✅ | 固定 `"1.0"` |
| `metadata` | object | ✅ | 见 5.2 |
| `adaptation_constraints` | object | ✅ | 见 5.3 |
| `source_chapters` | array | ✅ | 见 5.4 |
| `source_paragraphs` | array | ✅ | 见 5.5，**可校验锚点集** |
| `characters` | array | ✅ | 见 5.6 |
| `locations` | array | ✅ | 见 5.7 |
| `episodes` | array | ✅ | 见 5.8，结构容器 |
| `adaptation_notes` | array | ✅（可空） | 见 5.11 |
| `quality_report` | object | ✅ | 见 5.12，**系统计算，导入时一律重算**（§11） |

### 5.2 `metadata`
`title`(string) · `source_type`(`"novel"`) · `target_format`(`"screenplay"`) · `adaptation_profile`(`short_drama`\|`film`\|`series`\|`custom`) · `language`(string, 如 `zh-CN`) · `created_at`(ISO8601) · `generator`{`model`:string, `mode`:`live`\|`fixture`} · `source_fingerprint`(string，canonical 源指纹，见 §6.3)

### 5.3 `adaptation_constraints`（可配置，preset 提供默认）
`structure_unit`(`episode`\|`act`，决定 `episodes[]` 代表"集"还是"幕") · `episode_count`(int≥1) · `target_duration_seconds_per_episode`(int) · `opening_hook_required`(bool) · `cliffhanger_required`(bool) · `fidelity_level`(`faithful`\|`balanced`\|`creative`)

### 5.4 `source_chapters`
`id`(如 `ch1`) · `title`(string) · `index`(int≥1) · `summary`(string)

### 5.5 `source_paragraphs`（★ source_refs 只能引用这里的 id）
`id`(段落稳定 ID，见 §6.1) · `chapter_id`(引用 source_chapters.id) · `paragraph_index`(int≥1) · `text_preview`(string，截断预览) · `hash`(string，8 位)

> **全文 vs 预览**：YAML 中仅存 `text_preview` 以保持可读。解析阶段在内部保留**全文段落对象**（含完整 `text`），供 analyze/plan/generate 各 LLM 阶段消费；完整 `text` 不写入最终 YAML。

### 5.6 `characters`
`id`(**系统确定性生成**，见 §6.2，如 `char_linshen_3f9a1b`) · `name`(string) · `aliases`(string[]) · `role`(`protagonist`\|`antagonist`\|`supporting`\|`minor`) · `motivation`(string) · `relationship_notes`(string) · `source_refs`(string[]→source_paragraphs.id)

### 5.7 `locations`
`id`(**系统确定性生成**，见 §6.2，如 `loc_jiumatou_7b21c4`) · `name`(string) · `description`(string) · `source_refs`(string[])

### 5.8 `episodes`
`episode_no`(int≥1) · `title`(string) · `opening_hook`(string，short_drama 约束) · `core_conflict`(string) · `cliffhanger`(string) · `estimated_duration_seconds`(int) · `scenes`(array，见 5.9)

### 5.9 `scenes`
`scene_no`(int≥1) · `heading`{`int_ext`:`INT`\|`EXT`\|`INT_EXT`, `location_id`:→locations.id, `time_of_day`:`DAY`\|`NIGHT`\|`DAWN`\|`DUSK`\|`CONTINUOUS`} · `present_character_ids`(string[]→characters.id) · `summary`(string) · `beats`(array，见 5.10) · `source_refs`(string[]，场景级聚合)

### 5.10 `beats`（★ 单一有序列表）
公共：`beat_no`(int≥1) · `type`(`dialogue`\|`action`\|`transition`) · `source_refs`(string[])

按 `type` 的专有字段：
- `dialogue`：`character_id`(→characters.id) · `line`(string) · `parenthetical`(string，可选，如"低声")
- `action`：`description`(string)
- `transition`：`transition_kind`(`CUT_TO`\|`FADE_OUT`\|`FADE_IN`\|`DISSOLVE_TO`\|`SMASH_CUT`)

校验时按 `type` 做判别联合（discriminated union）。**严格项**（硬错误）：`type` 必须为合法判别值；该 type 的**必填**专有字段必须存在且类型正确。**宽松项**：不属于该 type 的多余/未知字段一律**告警而非硬失败**，且校验路径**不静默丢弃**（统一规则见 §10），避免在编辑中悄悄吃掉作者内容。

### 5.11 `adaptation_notes`（改编透明度）
`type`(`cut`\|`merge`\|`reorder`\|`original_addition`\|`pacing`) · `description`(string) · `source_refs`(string[]，可选)

### 5.12 `quality_report`（★ 全部由确定性内核计算，模型与用户均不参与填写）
`source_coverage_ratio`(float 0–1) · `referenced_paragraph_count`(int) · `total_paragraph_count`(int) · `missing_source_refs`(string[]，修复后应为空) · `repaired_refs`(string[]，生成阶段被自动剔除的非法引用，透明披露) · `untraceable_scenes`(string[]，剔除后溯源为空的场景，见 §11) · `unreferenced_key_paragraphs`(string[]，重要但未被引用的原文) · `constraint_warnings`(object[]，见 §10) · `manual_review_suggestions`(string[])

> 任何路径（生成 / 重校验）返回的 `quality_report` 都由系统**当场重算**；YAML 中用户填写的该字段一律忽略（§11）。

---

## 6. 确定性 ID 与文本规范化

系统拥有全部 ID 的生成权，模型不得自由编造。段落 ID 是溯源锚点（题目硬性要求）；实体 ID 让"引用完整性"这条主线在角色/地点上同样成立。

### 6.1 段落 ID

**ID 格式**：`ch{chapterNo}_p{paragraphNo}_{hash8}`，示例 `ch1_p3_a1b2c3d4`。
- `chapterNo`：章节序号，从 1 起。
- `paragraphNo`：章节内段落序号，从 1 起。
- `hash8`：规范化段落文本的 SHA-256 取前 8 位十六进制。

**规范化 `normalize(text)`**（决定 ID 幂等性）：
1. 去除首尾空白；
2. 统一换行 `\r\n`/`\r` → `\n`；
3. 合并连续空格/制表符为单个空格；
4. 保持中文标点与正文内容不变。

→ 保证：同一段文本重复解析得到**相同 ID**；空白差异**不影响** ID（验收 2、3）。

**设计取舍**：ID 同时编码位置（ch/p）与内容（hash），是"位置+内容"混合锚点。作者修改原文并重新解析视为**重新开始**（IDs 可能变化），v1 不做跨版本 ID 迁移。

### 6.2 实体 ID（角色 / 地点）

LLM 在 analyze 阶段只产出实体的**名称/别名/属性**（不负责定 ID）。确定性内核执行**实体归一化**后分配稳定 ID：

1. **归一化**：按规范化后的 `name` 与 `aliases` 去重合并同一实体（同名或别名命中即合并）。
2. **分配 ID**：
   - 角色 `char_{slug}_{hash6}`，地点 `loc_{slug}_{hash6}`。
   - `hash6`：规范化 canonical 名称的 SHA-256 取前 6 位十六进制——**唯一性与确定性的真正保证**。
   - `slug`：可选的可读前缀（名称的 ASCII/拼音化、清洗后；若无拼音依赖则可省略，退化为 `char_{hash6}`）。仅为可读性，不参与唯一性判定。
   - 极小概率 hash6 撞且 canonical 名不同时，追加数字后缀消歧。
3. **回填与注入**：内核据归一化结果重写所有 `character_id`/`location_id` 引用；并把"合法实体 ID 清单（含名称）"像段落 ID 一样**注入 plan/generate 的 prompt**，要求模型只能引用清单内 ID——与段落 ID 的反幻觉机制统一。

→ 保证：相同 analyze 输出得到相同实体 ID（fixture 模式下完全可复现）；引用完整性校验对实体与段落口径一致。LLM 跨次运行抽取差异导致的 ID 变化属模型方差，非 ID 方案缺陷。

### 6.3 源指纹 `source_fingerprint`

= 对 canonical `source_paragraphs` 的有序 `(id, hash)` 列表做 SHA-256 取前 16 位十六进制。写入 `metadata.source_fingerprint`，作为"这份剧本锚定于哪一次解析结果"的轻量证据，供 §10 的锚定校验使用。

---

## 7. 章节 / 段落解析规则

**章节标题识别**（按行匹配，支持下列模式，命中即为新章起点）：
- `^第\s*[0-9]+\s*[章回节卷]`（如 `第1章`、`第 12 回`）
- `^第\s*[一二三四五六七八九十百千零〇两]+\s*[章回节卷]`（如 `第一章`、`第二十回`）
- `^Chapter\s+\d+`（不区分大小写）
- 标题行内标题部分（标记后剩余文本）记为 `title`。

**段落切分**：章节正文按一个或多个空行切分；逐段 `trim`，丢弃空段；`paragraph_index` 从 1 起。

**章节数不足处理**（验收 1）：识别到 <3 章时，**不静默报错**，而是回显"已识别章节列表 + 数量"，提示作者确认或补充章节标记，并阻止进入生成。

---

## 8. 改编 Profile 与约束

`adaptation_profile` 选择一组 `adaptation_constraints` 默认值；用户可在生成前覆盖。

| profile | structure_unit | episode_count | duration/ep(s) | opening_hook | cliffhanger | fidelity |
|---|---|---|---|---|---|---|
| **short_drama**（v1 主推/默认） | episode | 3 | 120 | required | required | balanced |
| film | act | 3（三幕） | 自定义 | optional | optional | balanced |
| series | episode | N | 自定义 | required | optional | balanced |
| custom | 任意 | 任意 | 任意 | 任意 | 任意 | 任意 |

**通用性取舍**：v1 只用 `episodes[]` 一个结构容器，`structure_unit` 说明它代表"集/幕"。电影场景设 `episode_count: 1`。以一个容器换取 Schema 简洁与校验统一——此取舍写入 Schema 文档。`fidelity_level=balanced` 含义：保留主线与人物动机、允许压缩非核心情节/合并次要人物/重排部分情节，但不改变核心人物关系与主要冲突方向。

---

## 9. 多阶段 LLM Pipeline

不让模型一次性吐完整 YAML。流程（解析与实体归一化为纯代码，其余经 `ScriptProvider`）：

1. **parse**（纯代码）：文本 → 章节 + 段落 + 稳定 ID + 统计 + `source_fingerprint`。
2. **analyze**（LLM）：基于带 ID 原文 → 实体（characters/locations，仅名称/别名/属性，**不定 ID**） / `chapter_summaries` / `key_events` / `conflicts`。
3. **normalize-entities**（纯代码，作为 `/api/analyze` 的确定性尾步执行）：实体去重 + 分配确定性实体 ID（§6.2）+ 生成"合法实体 ID 清单 `entity_catalog`"，随 analyze 响应一并返回。
4. **plan-scenes**（LLM）：注入合法段落 ID + 实体 ID 清单 → `episodes` 骨架（含开场钩子、核心冲突、结尾悬念）、scene_plan、pacing_notes、adaptation_strategy。
5. **generate-script**（LLM）：注入合法 ID 清单 → 完整剧本 JSON（含 beat 级 `source_refs`，引用受限于清单）→ 进入校验闸门 → YAML。

**反幻觉约束**：每个需要引用的阶段，Prompt 中注入**合法段落 ID + 实体 ID 清单**并强制"只能引用清单内 ID"；模型用结构化输出（JSON）返回。

---

## 10. 校验策略与错误模型

**两条路径，区别对待非法 `source_ref`（用户拍板）**：
- **生成路径**：模型 JSON → schema 校验 → 引用完整性校验 → **非法 source_ref 自动剔除**，记入 `quality_report.repaired_refs` + 警告，并执行 §11 的最低溯源门槛 → 总能产出可用初稿。
- **手改重校验路径**（`/api/validate-yaml`）：YAML → schema → 引用 → 锚定 → 约束 → **硬报错**（`valid:false`），返回精确路径，并**重算 quality_report** 一并返回。

**锚定校验（防伪造源）**：引用完整性不能只在 YAML 内部自洽（否则用户伪造 `source_paragraphs` 即可绕过）。
- `/api/validate-yaml` 可选接收解析阶段的 **canonical `source_paragraph_ids`**（工作台流程默认携带，存于前端会话）。
- **携带 canonical 时**（强锚定）：校验 YAML 的 `source_paragraphs` 必须 ⊆ canonical 且 `source_refs` ⊆ canonical；并校验 `metadata.source_fingerprint` 与 canonical 一致。任何偏离 → 硬错误。
- **未携带 canonical 时**（脱离上下文的独立 YAML）：退化为内部一致性（`source_refs` ⊆ YAML 自带 `source_paragraphs`），并用 YAML 自带 `source_paragraphs` 重算指纹与 `metadata.source_fingerprint` 比对；同时给出告警 `SOURCE_UNVERIFIED`：未提供 canonical，源真实性无法对照原始解析。

**错误对象**：
```json
{ "path": "episodes[1].scenes[0].beats[3].source_refs[2]",
  "code": "INVALID_SOURCE_REF",
  "message": "source_ref 不存在：ch9_p1_zzzzzzzz" }
```
错误码（硬错误）：`YAML_SYNTAX_ERROR` · `SCHEMA_ERROR` · `INVALID_SOURCE_REF` · `INVALID_CHARACTER_REF` · `INVALID_LOCATION_REF` · `SOURCE_MISMATCH`（YAML 源与 canonical 不一致）· `CONSTRAINT_VIOLATION`。
告警码（不阻断）：`UNKNOWN_FIELD` · `SOURCE_UNVERIFIED` · `WEAK_TRACEABILITY`（见 §11）· `CONSTRAINT_WARNING`。

**Schema 宽严（统一规则，消除 §5.10 与本节的歧义）**：
- **硬失败**：缺必填字段、类型错误、枚举非法、beat 判别式/必填专有字段错误、（手改路径）引用与锚定错误。
- **告警不硬失败**：任意对象（含顶层、scene、beat）出现的**未知/多余字段**——产出 `UNKNOWN_FIELD` 告警并标出路径，校验路径**保留**用户内容、**不静默删除**。
此规则统一适用于全部对象类型，beat 不做"额外严格"，以保护"可编辑"体验下作者的手写内容。

**约束检查**（产出 `constraint_warnings`，手改路径升级为 `CONSTRAINT_VIOLATION`）：集数是否等于 `episode_count`；每集 `estimated_duration_seconds` 是否接近目标；`opening_hook_required` 时首集是否有非空 `opening_hook`；`cliffhanger_required` 时各集是否有非空 `cliffhanger`。

---

## 11. `quality_report` 计算口径（确定性）与最低溯源门槛

**任何返回都当场重算**（生成路径与 `/api/validate-yaml` 均如此）；用户/模型写入的 `quality_report` 一律忽略，以重算值为准。计算口径：

- `total_paragraph_count` = source_paragraphs 数量（强锚定时以 canonical 为准）。
- `referenced_paragraph_count` = 全剧（characters/locations/scenes/beats/notes）中出现过的**去重**合法 source_ref 数。
- `source_coverage_ratio` = referenced / total。
- `missing_source_refs` = 引用了但不存在的 ID（生成路径修复后应空）。
- `repaired_refs` = 生成阶段被剔除的非法 ID。
- `unreferenced_key_paragraphs` = 由简单启发式（如长度/关键词）标记为重要却未被引用的段落 ID（best-effort，可为空）。
- `manual_review_suggestions` = 基于约束告警与覆盖率生成的可读建议。

**最低溯源门槛**（采纳评审 #5，落点为"升级告警"而非"生成失败"，以不违背"生成总能产出可用初稿"的既定决策）：
- 自动剔除后，**某场景的场景级与全部 beat 级 source_refs 同时为空** → 记入 `quality_report.untraceable_scenes` 并产生 `WEAK_TRACEABILITY` 告警，点名 `episodes[i].scenes[j]`，附 `manual_review_suggestions`。
- `source_coverage_ratio` 低于阈值（默认 0.5，可配置）→ 强 `WEAK_TRACEABILITY` 告警。
- 上述均**不阻断生成**；仅在 UI 高亮，提示作者补溯源。可选（P1）：对溯源为空的场景做一次定向 re-anchor 再生成。

---

## 12. 确定性 Fixture 模式

`FixtureProvider` 在 **无 `OPENAI_API_KEY`** 或 **`DEMO_MODE=fixture`** 时启用，**仅对内置 Demo 小说**（按 canonical `source_fingerprint` 精确匹配）返回**预生成、已校验**的 analyze/plan/script 结果，瞬时返回。

**重要范围澄清（采纳评审 #6）**：fixture **只覆盖内置 Demo**，不是"无 Key 也能 AI 生成任意文本"。Provider 选择与边界：
- `DEMO_MODE=fixture`：强制 fixture。输入为内置 Demo → 完整跑通；输入为自定义文本（指纹不匹配）→ 明确提示"fixture 无此文本对应结果，请配置 API Key 使用 live 模式"，不静默伪造。
- 有 `OPENAI_API_KEY` 且非强制 fixture：用 `LiveLLMProvider`，任意文本走实时生成。
- 无 `OPENAI_API_KEY`：内置 Demo → fixture 跑通；自定义文本 → UI 明确提示需配置 `OPENAI_API_KEY`，不回退、不伪造。

价值：评委一键跑通内置 Demo（无需 Key）、测试可确定性复现、CI 不触网、把确定性内核与随机 LLM 解耦——强化工程深度叙事（验收 8）。

---

## 13. API 契约

| 路由 | 入 | 出 |
|---|---|---|
| `POST /api/parse` | `{text}` | `{chapters, source_paragraphs, source_fingerprint, stats:{chapter_count,paragraph_count,character_count}, checks:{meets_minimum_chapters:bool}}` |
| `POST /api/analyze` | `{chapters, source_paragraphs}` | `{characters, locations, entity_catalog, chapter_summaries, key_events, conflicts}`（analyze LLM 抽取实体后，由确定性 normalize-entities 尾步去重并赋予稳定实体 ID，`entity_catalog` 即合法实体 ID 清单） |
| `POST /api/plan-scenes` | `{analyze 结果（含 entity_catalog）, source_paragraphs, constraints}` | `{episodes(骨架), scene_plan, pacing_notes, adaptation_strategy}` |
| `POST /api/generate-script` | 前序结果 | `{script_json, script_yaml, validation_result, quality_report}` |
| `POST /api/validate-yaml` | `{yaml, source_paragraph_ids?}`（可选 canonical 锚定上下文） | `{valid, errors:[{path,code,message}], warnings:[{path,code,message}], quality_report}`（report 重算返回） |

各阶段结果在前端缓存（含 canonical `source_paragraph_ids`，供 validate 锚定），重跑后续阶段不必重跑前序（降低成本/延迟）。

---

## 14. 前端工作台

不做营销落地页，直接做工具工作台，模块：
1. **输入区**：文本粘贴 / TXT 上传 / 加载内置 Demo。
2. **流程区**：解析 → 分析 → 规划 → 生成 → 校验，分步可见、可重跑。
3. **中间结果区**：章节列表、段落 ID、人物表、事件线、场景规划。
4. **YAML 编辑区**：可编辑 YAML + "重新校验"按钮 + 路径级错误/告警提示 + 重算后的 quality_report 展示。
5. **导出区**：`script.yaml` / `script.json` / `script-yaml-schema.md` / `adaptation-report.md`。

---

## 15. 测试策略

**确定性内核单元测试**（不触网）：
- `normalize` + `paragraph-id`：幂等性、空白不变性、不同内容不同 hash。
- `entity-id` + `normalize-entities`：同名/别名合并、确定性 ID、引用回填、撞 hash 消歧。
- `chapters`：各章节标题模式、段落切分、<3 章回显。
- `script-schema`：合法样例通过；缺字段/错枚举/beat 联合错误被拒；未知字段产出告警而非失败。
- `referential`：合法引用通过；非法 source_ref/character_id/location_id 命中并给路径。
- `anchor`：携带 canonical 时伪造 `source_paragraphs`/指纹被拒（`SOURCE_MISMATCH`）；未携带时给 `SOURCE_UNVERIFIED` 告警。
- `constraints`：集数/时长/钩子/悬念违例被检出。
- `convert` + `fingerprint`：JSON→YAML→parse→JSON 往返一致；指纹可复算。
- `quality-report`：覆盖率/修复列表/`untraceable_scenes`/覆盖率阈值告警计算正确；用户填写的 report 被忽略重算。

**集成测试**：fixture 模式跑完整 pipeline（parse→analyze→normalize→plan→generate→validate），断言产出 schema-valid、source_refs 全部存在、强锚定通过。

工具：Vitest（轻量、TS/ESM 友好）。

---

## 16. 技术栈与环境变量

- **栈**：Next.js（App Router）+ TypeScript + Zod + `yaml` + OpenAI 兼容（`openai` SDK 或 fetch）+ Vitest。
- **环境变量**（`.env.example` 仅示例）：`OPENAI_API_KEY`（live 模式必需）、`OPENAI_BASE_URL`（可选）、`MODEL_NAME`（可选，默认 `gpt-4o-mini`）、`DEMO_MODE`（可选 `fixture`）。
- **安全**：不提交任何真实 Key；`.env` 已在 `.gitignore`。

---

## 17. 落地顺序（贴合 2026-06-07 截止）

- **P0 必达**：脚手架；确定性内核（解析+段落ID、实体归一化+实体ID、Zod Schema、校验器含锚定、quality_report 重算、JSON↔YAML、fingerprint）；`FixtureProvider` + Demo 小说 + fixtures；一条可跑生成链路；最小工作台（粘贴/Demo → 生成 → 展示 YAML + 中间结果 → 重校验）；**Schema 设计文档**；README。
- **P1**：`LiveLLMProvider` 三阶段；YAML 编辑器 + 路径级错误/告警 UI；四种导出；溯源为空场景的定向 re-anchor。
- **P2**：打磨、更多章节格式、Demo 视频脚本。

PR 拆分沿用根方案第 9 节（7 个 PR），但以 P0 为可演示底线。合规细则见 §20。

---

## 18. 验收标准

1. 输入 <3 章 → 阻止生成并回显已识别章节。
2. 同一文本重复解析 → 相同段落 ID。
3. 空白差异不影响段落 ID。
4. 生成产出中的 `source_refs` 必然真实存在（自动修复保证）；手改非法引用 → 精确路径报错。
5. YAML 可编辑。
6. 编辑后可重新校验。
7. 错误提示含明确路径。
8. 内置 Demo 在 fixture 模式下无需 Key 完整跑通；自定义文本无 Key 时给出明确"需配置 Key"提示而非伪造。
9. README 步骤可复现。
10. 单元测试 + fixture 集成测试通过。
11. 携带 canonical 上下文时，伪造 `source_paragraphs` 或指纹被拒（锚定校验生效）。
12. `/api/validate-yaml` 返回的 `quality_report` 为系统重算值，用户手填值被忽略。
13. 实体 ID 由系统确定性生成；fixture 模式下可复现。
14. 自动剔除后溯源为空的场景被标记为 `WEAK_TRACEABILITY` 告警（不阻断生成）。

---

## 19. Schema 设计原因（要点，详见 `docs/script-yaml-schema.md`）

1. **稳定段落 ID + source_refs（系统生成、可锚定）**：防模型编造引用、内容可追溯到原文、支持自动校验与人工审查；引用以原始解析结果（canonical + 指纹）为准，杜绝"伪造源自洽"。
2. **约束写进 YAML**：集数/时长/钩子/悬念是改编质量关键，写入后可自动检查、便于作者调整。
3. **单一有序 `beats`**：对白与动作天然交错，单列表顺序明确、易渲染易编辑，优于三个并行数组。
4. **全 ID 引用 + 引用完整性（段落与实体均系统确定性生成）**：角色/地点/段落统一用稳定 ID，校验器统一查存在性，是贯穿设计的"可校验"主线。
5. **`quality_report` 由系统计算且每次重算**：输出不只是剧本，还含可量化、可信的改进方向；不信任 YAML 内的手填值。
6. **`adaptation_notes`**：改编非逐字转换，需记录删减/合并/重排/原创补充，让作者理解 AI 的选择。
7. **通用容器 + profile**：满足通用"剧本"要求，短剧只是默认 preset，兼顾通用性与演示亮点。

---

## 20. 开发过程合规计划

面向竞赛硬性提交门槛，集中成可执行清单（与根方案 §9–§11 呼应，不重复其细节）：

- **时间窗口**：2026-06-05 00:00 – 2026-06-07 23:00（北京时间）内持续提交；主分支始终保持可运行。
- **分支/PR 节奏**：按根方案 §9 的 7 个 PR 拆分推进；以 §17 的 P0 为可演示底线。每个 PR 描述含四段：标题（一句话）/ 功能描述 / 实现思路 / 测试方式。
- **依赖与原创声明**：README 列明第三方库及用途，并标注哪些为原创实现（确定性内核：段落/实体 ID、归一化、校验器、锚定、quality_report、YAML 转换；Demo 小说为原创）。
- **不泄密**：仅提交 `.env.example`；真实 Key 永不入库；提交前自查 diff 无密钥。
- **Demo 视频检查清单**：完整展示 输入 → 解析（章节/段落 ID）→ 生成 → 溯源（source_refs）→ 编辑 → 重校验（路径级错误 + 重算 report）→ 导出 全流程。
- **提交信息规范**：清晰、描述性；遵循协作署名约定。

---

## 21. 外部评审吸收记录（v1.1）

| # | 评审建议 | 处置 | 落点 |
|---|---|---|---|
| 1 | validate-yaml 不能只收 `{yaml}`，应锚定 canonical 源 | 采纳 | §10 锚定校验、§6.3 指纹、§13 入参、§5.2 字段 |
| 2 | quality_report 应重算，不信 YAML 内值 | 采纳 | §11、§13 出参、§5.12 |
| 3 | 角色/地点 ID 也要确定性生成 | 采纳 | §6.2 实体归一化与 ID、§9 流程、§5.6/5.7 |
| 4 | §5.10 与 §10 宽严策略冲突 | 采纳，改其解法 | §10 统一规则（未知字段一律告警、严格只限判别/必填/类型，beat 不额外严格） |
| 5 | 自动剔除需最低质量门槛 | 采纳，拒绝"生成失败"分支 | §11 `WEAK_TRACEABILITY` 告警 + `untraceable_scenes`，不阻断生成 |
| 6 | fixture 仅保证内置 Demo | 采纳 | §12 范围澄清与 Provider 边界 |
| 7 | 写入开发过程合规计划 | 采纳（轻量） | §20 |
