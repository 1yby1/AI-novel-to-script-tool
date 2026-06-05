# AI 小说转短剧剧本工具项目方案

## 1. 项目背景

选择笔试题目三：AI 小说转剧本工具。

目标是开发一个 Web 工作台，帮助小说作者将 3 个章节以上的中文小说文本自动改编成结构化短剧剧本，并输出 YAML 格式。项目不仅要能生成剧本，还要具备可追溯、可校验、可编辑的工程能力，避免只是简单 Prompt 包装器。

最终提交内容包括：

- 公开 GitHub 仓库
- README 文档
- Demo 视频
- YAML Schema 设计文档
- 可运行的本地 Web Demo

## 2. 核心定位

项目名称可暂定为：

**Novel2Script：AI 小说转短剧剧本工作台**

目标用户：

- 小说作者
- 短剧编剧
- 内容改编团队
- 需要快速获得剧本初稿的创作者

核心场景：

用户粘贴或上传 TXT 小说文本，系统自动解析章节和段落，生成短剧改编方案，并输出可编辑、可校验、可追溯的 YAML 剧本。

## 3. 功能范围

### 3.1 文本输入

- 支持直接粘贴小说文本。
- 支持上传 TXT 文件。
- 内置一份原创三章节 Demo 文本，方便评审直接体验。

### 3.2 章节解析

- 支持至少 3 个章节。
- 少于 3 章时阻止生成并提示。
- 支持常见章节格式，例如 `第1章`、`第一章`。

### 3.3 稳定段落 ID

系统必须为原文每个段落生成稳定 ID，使 `source_refs` 真正可校验，而不是由模型自由填写。

ID 格式：

```text
ch{chapterNo}_p{paragraphNo}_{hash8}
```

示例：

```text
ch1_p3_a1b2c3d4
```

生成规则：

- `chapterNo`：章节序号，从 1 开始。
- `paragraphNo`：章节内段落序号，从 1 开始。
- `hash8`：规范化段落文本后的 8 位 hash。

规范化规则：

- 去除首尾空白。
- 统一换行。
- 合并连续空格。
- 保持中文标点和正文内容不变。

后续 YAML 中的 `source_refs` 只能引用系统生成的段落 ID。校验器必须检查所有引用是否真实存在。

### 3.4 AI 多阶段生成

不要让模型一次性直接生成完整 YAML。推荐使用多阶段流程：

1. 章节分析
   - 输出章节摘要。
   - 抽取人物。
   - 抽取地点。
   - 抽取关键事件。
   - 抽取主要冲突。

2. 短剧结构规划
   - 将小说事件改编为 3 集短剧结构。
   - 每集约 2 分钟。
   - 每集包含开场钩子、核心冲突、关键反转、结尾悬念。

3. 剧本 JSON 生成
   - 生成结构化 JSON。
   - JSON 中必须包含可校验的 `source_refs`。

4. 校验与 YAML 转换
   - 使用 Zod 校验 JSON。
   - 检查 `source_refs`。
   - 校验通过后转换成 YAML。

### 3.5 短剧改编约束

默认短剧规格：

- 3 集。
- 每集约 2 分钟。
- 第一集前 15 秒必须有强钩子。
- 每集包含核心冲突。
- 每集结尾包含悬念或未完成冲突。

改编忠实度：

```text
balanced
```

含义：

- 保留主线。
- 保留人物动机。
- 允许压缩非核心情节。
- 允许合并次要人物。
- 允许重排部分情节以增强短剧节奏。
- 不允许改变核心人物关系和主要冲突方向。

### 3.6 YAML 可编辑与重新校验

页面中必须展示最终 YAML，并允许用户直接编辑。

用户点击“重新校验”后，系统检查：

- YAML 语法错误。
- Schema 字段错误。
- `source_refs` 是否引用不存在的段落 ID。
- 是否缺少短剧约束字段。
- 集数、时长、开场钩子、结尾悬念是否满足约束。

错误提示需要包含明确路径，例如：

```text
episodes[1].scenes[0].source_refs[2]
```

### 3.7 导出功能

支持导出：

- `script.yaml`
- `script.json`
- `script-yaml-schema.md`
- `adaptation-report.md`

## 4. 技术架构

推荐技术栈：

- Next.js App Router
- TypeScript
- Route Handlers
- Zod
- yaml
- OpenAI 兼容接口

AI 接入方式：

- 使用 OpenAI 兼容 API。
- 环境变量：
  - `OPENAI_API_KEY`
  - `OPENAI_BASE_URL` 可选
  - `MODEL_NAME` 可选

安全要求：

- 不要提交真实 API Key。
- 只提交 `.env.example`。
- README 中说明如何配置环境变量。

## 5. 后端接口设计

### 5.1 `POST /api/parse`

职责：

- 接收文本或 TXT。
- 解析章节。
- 生成段落 ID。
- 返回章节、段落、字数统计、校验结果。

输入：

```json
{
  "text": "小说全文"
}
```

输出：

```json
{
  "chapters": [],
  "source_paragraphs": [],
  "stats": {
    "chapter_count": 3,
    "paragraph_count": 42,
    "character_count": 12000
  }
}
```

### 5.2 `POST /api/analyze`

职责：

- 基于带段落 ID 的原文进行分析。
- 输出人物、地点、事件、冲突、章节摘要。

输出内容：

- characters
- locations
- chapter_summaries
- key_events
- conflicts

### 5.3 `POST /api/plan-scenes`

职责：

- 根据分析结果规划 3 集短剧结构。
- 每集包含开场钩子、核心冲突、结尾悬念。

输出内容：

- episodes
- scene_plan
- pacing_notes
- adaptation_strategy

### 5.4 `POST /api/generate-script`

职责：

- 生成剧本 JSON。
- 用 Zod 校验。
- 校验 `source_refs` 是否真实存在。
- 转换为 YAML。

输出内容：

- script_json
- script_yaml
- validation_result
- adaptation_report

### 5.5 `POST /api/validate-yaml`

职责：

- 接收用户编辑后的 YAML。
- parse YAML。
- 执行 Schema 校验。
- 执行引用校验。
- 执行短剧约束校验。
- 返回错误路径和错误原因。

输入：

```json
{
  "yaml": "schema_version: \"1.0\"..."
}
```

输出：

```json
{
  "valid": false,
  "errors": [
    {
      "path": "episodes[1].scenes[0].source_refs[2]",
      "message": "source_ref 不存在：ch2_p9_xxxxxxxx"
    }
  ]
}
```

## 6. YAML Schema 核心字段

顶层结构建议：

```yaml
schema_version: "1.0"
metadata: {}
adaptation_constraints: {}
source_chapters: []
source_paragraphs: []
characters: []
locations: []
episodes: []
adaptation_notes: []
quality_report: {}
```

### 6.1 `metadata`

保存作品基础信息。

建议字段：

- `title`
- `source_type`
- `target_format`
- `language`
- `created_at`
- `model`

### 6.2 `adaptation_constraints`

保存短剧改编约束。

建议字段：

- `episode_count`
- `target_duration_seconds_per_episode`
- `opening_hook_required`
- `cliffhanger_required`
- `fidelity_level`

### 6.3 `source_chapters`

保存来源章节信息。

建议字段：

- `id`
- `title`
- `index`
- `summary`

### 6.4 `source_paragraphs`

保存原文段落 ID。

建议字段：

- `id`
- `chapter_id`
- `paragraph_index`
- `text_preview`
- `hash`

所有 `source_refs` 必须引用这里存在的 `id`。

### 6.5 `characters`

保存人物素材库。

建议字段：

- `id`
- `name`
- `aliases`
- `role`
- `motivation`
- `relationship_notes`
- `source_refs`

### 6.6 `locations`

保存地点素材库。

建议字段：

- `id`
- `name`
- `description`
- `source_refs`

### 6.7 `episodes`

表示短剧集数，默认 3 集。

每集建议字段：

- `episode_no`
- `title`
- `opening_hook`
- `core_conflict`
- `cliffhanger`
- `estimated_duration_seconds`
- `scenes`

### 6.8 `scenes`

表示具体场景。

每场建议字段：

- `scene_no`
- `location_id`
- `time_of_day`
- `characters`
- `summary`
- `beats`
- `dialogues`
- `actions`
- `source_refs`

### 6.9 `adaptation_notes`

记录改编说明。

建议记录：

- 删减
- 合并
- 重排
- 原创补充
- 节奏调整

### 6.10 `quality_report`

记录质量反馈。

建议字段：

- `source_coverage_ratio`
- `missing_source_refs`
- `constraint_warnings`
- `manual_review_suggestions`

## 7. Schema 设计原因

Schema 文档需要重点说明以下设计原因：

1. 为什么需要稳定段落 ID
   - 防止模型自由编造引用。
   - 让剧本内容可以追溯到原文。
   - 便于自动校验和人工审查。

2. 为什么要把短剧约束写进 YAML
   - 集数、时长、开场钩子、结尾悬念是短剧改编质量的关键。
   - 写入 YAML 后可以自动检查。
   - 方便作者后续调整。

3. 为什么采用 `episodes.scenes.beats`
   - 短剧天然以集和场组织。
   - beats 适合表达剧情节奏。
   - 比纯文本剧本更适合结构化编辑。

4. 为什么保留 `adaptation_notes`
   - 改编不是逐字转换。
   - 需要记录删减、合并、重排和原创补充。
   - 让作者理解 AI 的改编选择。

5. 为什么保留 `quality_report`
   - 让输出不只是剧本，还包含可改进方向。
   - 便于答辩时展示可量化反馈。

## 8. 前端页面设计

不要做营销落地页，直接做工具工作台。

页面模块：

1. 输入区
   - 文本粘贴
   - TXT 上传
   - 加载内置 Demo

2. 生成流程区
   - 章节解析
   - 人物/事件分析
   - 短剧结构规划
   - 剧本生成
   - YAML 校验

3. 中间结果区
   - 展示章节列表
   - 展示段落 ID
   - 展示人物表
   - 展示事件线
   - 展示场景规划

4. YAML 编辑区
   - 可编辑 YAML
   - 重新校验按钮
   - 错误路径提示

5. 导出区
   - 下载 YAML
   - 下载 JSON
   - 下载 Schema 文档
   - 下载改编报告

## 9. GitHub PR 与提交规划

必须使用 GitHub 仓库，并保持持续 PR 和 commit。

开发时间窗口：

```text
2026-06-05 00:00 至 2026-06-07 23:00，中国北京时间
```

建议 PR 拆分：

1. PR 1：项目初始化、README 草稿、基础工作台页面。
2. PR 2：章节解析、TXT 上传、稳定段落 ID。
3. PR 3：YAML Schema、Zod 类型、引用校验器。
4. PR 4：短剧约束建模、场景规划 Prompt。
5. PR 5：AI 多阶段 pipeline 和 OpenAI 兼容调用。
6. PR 6：YAML 编辑器、重新校验和错误路径提示。
7. PR 7：导出功能、README 完善、Demo 视频脚本。

每个 PR 必须包含：

- 标题：一句话说明新增或修改了什么。
- 功能描述：说明功能作用和使用方式。
- 实现思路：说明技术选型或核心逻辑。
- 测试方式：说明如何验证功能正常。

## 10. README 必须包含

README 需要写清楚：

- 所选题目：题目三，AI 小说转剧本工具。
- 项目简介。
- 核心功能。
- 技术栈。
- 第三方依赖及用途。
- 哪些部分是原创实现。
- 环境变量配置。
- 本地运行方式。
- Demo 视频链接。
- PR/commit 持续开发说明。
- YAML Schema 文档链接。
- 示例输入和示例输出。

## 11. 测试与验收标准

必须验证：

1. 输入少于 3 章时会报错。
2. 同一段文本重复解析生成相同段落 ID。
3. 空白差异不会影响段落 ID。
4. AI 生成内容中的 `source_refs` 必须真实存在。
5. YAML 可编辑。
6. 编辑后的 YAML 可重新校验。
7. 错误提示包含明确路径。
8. 内置 Demo 能完整跑通。
9. README 步骤可复现。
10. Demo 视频能展示输入、生成、追溯、编辑、校验、导出全过程。

## 12. 项目边界

v1 不做：

- 登录系统
- 数据库
- 多用户协作
- DOCX/PDF 解析
- 云端部署强依赖
- 复杂剧本专业排版
- 多语言输入输出

v1 聚焦：

```text
中文小说 -> 中文短剧分场剧本 -> 可追溯 YAML -> 可编辑校验
```

## 13. 给实现 AI 的注意事项

- 不要直接一次性让模型生成最终 YAML。
- 必须先生成系统级稳定段落 ID。
- `source_refs` 必须可校验。
- YAML 应由已校验 JSON 转换得到，而不是完全依赖模型直接输出。
- 页面应展示中间过程，方便评委理解技术深度。
- README 必须列明第三方库和原创功能。
- 不要提交任何密钥。
- 主分支始终保持可运行。
