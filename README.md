# Novel2Script · AI 小说转剧本工具

> 笔试题目三：**AI 小说转剧本工具**。把 3 章以上的中文小说，自动转成**结构化、可编辑、可校验、可追溯**的剧本 YAML 初稿。

Novel2Script 是一个本地运行的剧本创作工作台。它的核心不是"把小说丢给模型自由发挥"，而是把**确定性内核**（解析、稳定 ID、引用完整性、约束、质量报告）与**随机的 LLM 创意层**解耦：模型只负责改编创意，其产出必须通过代码校验闸门，才会变成 YAML。因此剧本里的每一句台词都能**回指原文段落**，每条引用与短剧约束都能被**程序自动检查**。

- **无需 API Key**：内置一份原创三章 Demo 小说 + 确定性 fixtures，离线即可完整跑通（评委零配置复现）。
- **配置 API Key 后**：可把**任意**≥3 章小说经真实 LLM 转成同样可校验的剧本。

---

## 核心功能

- **章节解析 + 稳定段落 ID**：纯代码解析章节/段落，为每段生成稳定 ID（`ch{章}_p{段}_{hash8}`），同一文本永远同 ID、排版差异不影响；整篇有 `source_fingerprint` 防伪造。
- **确定性实体 ID**：人物/地点 ID 由系统按名称生成（`char_/loc_…`），不让模型乱编，保证引用稳定。
- **多阶段改编 pipeline**：解析 → 分析（人物/地点/事件卡/冲突卡/关系/钩子候选）→ 短剧规划（集目标/场景目的/冲突/情绪转折/覆盖率）→ 生成结构化剧本。
- **可追溯 YAML**：集 → 场景 → **有序 beats**（对白/动作/转场），每处带 `source_refs` 指回原文段落。
- **可校验闭环**：Zod 结构校验（容器宽松 / beats 严格）+ 引用完整性 + canonical 锚定 + 短剧约束 + 规划一致性 + **重算的质量报告**；错误带**精确路径**（如 `episodes[0].scenes[1].beats[2].source_refs[0]`）。
- **错误回灌重试**：live 生成阶段会把结构错误、非法/被修复引用、弱追溯、短剧约束警告、规划不一致等问题反馈给模型重试，减少“一次生成看似成功但后验校验失败”的情况。
- **可编辑**：工作台内直接改 YAML → 一键重新校验。
- **YAML Schema 设计文档**：见 [`docs/script-yaml-schema.md`](docs/script-yaml-schema.md)。

---

## 近期强化点

- **分析结构升级**：分析阶段不再只给扁平事件/冲突，而是输出可引用的 `key_events`、`conflicts`、`relationship_edges`、`hook_candidates`；事件带 `dramatic_function`，冲突带 `stakes/escalation`，所有卡片都必须绑定 `source_refs`。
- **规划结构升级**：规划阶段输出 `episodes` 与细粒度 `scene_plan`；每场包含 `purpose`、`conflict`、`emotional_shift`、`required_character_ids`、`event_ids`、`source_refs`，并计算事件覆盖率，方便检查是否漏改关键剧情。
- **生成校验前置**：`LiveLLMProvider.generateScript` 在返回 YAML 前先组装完整 `Script`，运行 `validateScriptObject(..., { mode: "generate" })`，再检查生成场景是否遵守规划。
- **反馈更精确**：生成失败不只报“格式错”，而是把 path 级错误、规划缺失场景/人物/引用、`repaired_refs`、`WEAK_TRACEABILITY`、`CONSTRAINT_WARNING` 等具体问题回灌给模型。
- **解析鲁棒性 + TXT 上传（已实现）**：更宽但带防误判的章节边界识别（`第01章：`/`1、`/`一、`/`Chapter 02 -`，且不把编号正文误判成标题）、长段落按句切分、非阻断解析 warnings、前端 UTF-8 `.txt` 上传；方案见 [`docs/superpowers/plans/2026-06-07-parse-boundaries-txt-upload.md`](docs/superpowers/plans/2026-06-07-parse-boundaries-txt-upload.md)。

---

## 快速开始

### 环境要求
- Node.js **20+**、npm

### 安装
```bash
npm install
```

### （可选）配置 API Key —— 启用对自定义小说的 live 生成
**API Key 配在项目根目录的 `.env.local` 里**（Next.js 自动读取，仅服务端可见，不会泄露到前端；`.env.local` 已被 `.gitignore` 忽略，不会提交）：

```bash
# Windows
copy .env.example .env.local
# macOS / Linux
cp .env.example .env.local
```

编辑 `.env.local`：
```dotenv
OPENAI_API_KEY=sk-你的key
# 可选：指向任意 OpenAI 兼容端点（如 Qwen / DeepSeek）
OPENAI_BASE_URL=https://your-endpoint/v1
MODEL_NAME=gpt-4o-mini
```
> 改完 **重启 `npm run dev`** 生效。**不配 Key 也能用**——内置 Demo 走离线 fixture，无需任何配置。

### 运行
```bash
npm run dev
```
打开 Next.js 打印的本地地址（通常 `http://localhost:3000`）。

---

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `OPENAI_API_KEY` | 仅 live 模式 | — | OpenAI 兼容 Key。设置后（且 `DEMO_MODE≠fixture`）自定义小说走真实 LLM。 |
| `OPENAI_BASE_URL` | 否 | OpenAI 官方 | 任意 OpenAI 兼容端点（Qwen/DeepSeek/自建等）。 |
| `MODEL_NAME` | 否 | `gpt-4o-mini` | 模型名。 |
| `OPENAI_TIMEOUT_MS` | 否 | `60000` | 单次调用超时（毫秒）。 |
| `LLM_MAX_RETRIES` | 否 | `2` | 校验失败回灌重试次数。 |
| `DEMO_MODE` | 否 | — | 设为 `fixture` 时强制离线 Demo，即使配了 Key。 |

> 安全：**切勿提交真实 Key**。仓库只提交 `.env.example`。

---

## 使用流程

在工作台依次点击（按钮按流程**依次解锁**）：

1. **载入 Demo** / **上传 TXT**（或在"原文"框粘贴你自己的 ≥3 章小说；支持 UTF-8 `.txt` 文件）
2. **解析** → 章节/段落 + 稳定 ID + 指纹徽章；流程栏显示非阻断解析提示（前言保留 / 章节过少 / 空章 / 长段落拆分）
3. **分析** → 人物/地点（确定性 ID）+ 事件卡 + 冲突卡 + 人物关系 + 钩子候选
4. **规划** → 3 集短剧结构 + 场景级目的/冲突/情绪转折/引用覆盖
5. **生成** → 先做结构/引用/规划一致性校验与错误回灌，再在右栏输出可编辑 YAML + 质量报告
6. **编辑 + 校验** → 改 YAML 后点"重新校验"，错误会标出精确路径

> **自定义小说**：粘贴文本即可解析/分析/规划；但"生成"自定义文本需配置 `OPENAI_API_KEY`（否则仅内置 Demo 可生成，UI 会提示）。右上角徽章显示当前为 **live 模式** 还是 **离线 Demo**。

---

## 测试与验证

```bash
npm test        # 确定性内核 + LLM 适配层 + fixture 集成，全程不触网
npm run typecheck
npm run build
```

---

## 技术栈

Next.js 16（App Router）· React 19 · TypeScript · Zod 4 · yaml 2 · openai 6（OpenAI 兼容）· lucide-react · Vitest 4。

## 第三方依赖及用途

| 依赖 | 用途 |
|---|---|
| `next` / `react` / `react-dom` | 本地工作台（页面 + API Route Handlers） |
| `zod` | 剧本结构 Schema 校验 |
| `yaml` | YAML 序列化 / 解析 |
| `openai` | 调用 OpenAI 兼容接口（live 模式） |
| `lucide-react` | UI 图标 |
| `vitest` / `typescript` | 测试与类型检查 |

## 原创实现（本仓库自研）

第三方库仅作基础设施（框架/校验/序列化/HTTP 客户端/图标/测试）。以下均为原创：

- 文本规范化 + 章节解析 + **稳定段落 ID**（`src/core/parse`）
- **确定性实体 ID** + 实体归一化去重（`src/core/entities`）
- 剧本 **Zod Schema**（容器宽松 / beats 严格判别联合）+ 改编 profiles（`src/core/schema`）
- **校验器**：结构 / 引用完整性 / canonical 锚定 / 短剧约束 / 质量报告重算（`src/core/validate`）
- YAML 转换（`src/core/yaml`）
- **LLM 适配层**：fixture provider、`LiveLLMProvider`（结构化输出 + 全量校验回灌重试 + 规划一致性检查 + 系统组装 + 反幻觉 ID 注入）、provider 选择（`src/llm`）
- 工作台 UI + API 编排（`src/app`）
- **YAML Schema 设计文档**（`docs/script-yaml-schema.md`）与**原创三章 Demo 小说**（`fixtures/demo-novel.txt`）

## 项目结构

```
src/core/      确定性内核（解析/ID/Schema/校验/YAML），不依赖框架与网络
src/llm/       provider 接口、fixture provider、LiveLLMProvider、provider 选择
src/app/       Next.js 工作台页面 + /api 路由
fixtures/      原创 Demo 小说 + 预生成结果（离线演示/测试用）
docs/          Schema 设计文档、Demo 视频脚本、设计 spec 与实现计划
tests/         单元测试 + fixture 全链路集成测试
```

---

## YAML Schema 文档 / Demo 视频

- **Schema 设计文档（含设计原因）**：[`docs/script-yaml-schema.md`](docs/script-yaml-schema.md)
- **Demo 视频脚本/分镜**：[`docs/demo-video-script.md`](docs/demo-video-script.md)
- **分析/规划强化方案**：[`docs/superpowers/plans/2026-06-07-analysis-planning-v2.md`](docs/superpowers/plans/2026-06-07-analysis-planning-v2.md)
- **生成校验与错误回灌方案**：[`docs/superpowers/plans/2026-06-07-generation-validation-feedback.md`](docs/superpowers/plans/2026-06-07-generation-validation-feedback.md)
- **解析边界与 TXT 上传方案**：[`docs/superpowers/plans/2026-06-07-parse-boundaries-txt-upload.md`](docs/superpowers/plans/2026-06-07-parse-boundaries-txt-upload.md)
- **Demo 视频**：_（录制后填入链接）_

---

## 示例

**输入**（`fixtures/demo-novel.txt` 节选）：
```text
第一章 归港

林深在雾港的旧码头停下脚步，海风把三年前那场沉船的咸味重新卷回他的喉咙。
...
```

**输出**（生成 YAML 节选，每个 beat 回指原文）：
```yaml
episodes:
  - episode_no: 1
    title: 归来
    opening_hook: ...
    scenes:
      - scene_no: 1
        heading: { int_ext: EXT, location_id: loc_a31088, time_of_day: NIGHT }
        present_character_ids: [char_aadd69]
        beats:
          - { beat_no: 1, type: action, description: "...", source_refs: [ch1_p1_df6f5806] }
        source_refs: [ch1_p1_df6f5806]
quality_report:
  source_coverage_ratio: 1.0   # 由系统计算
```
完整示例见 `fixtures/demo-script.yaml`。

---

## 开发过程

- 采用**特性分支 + PR** 持续开发；每个阶段一条分支/一份实现计划（见 `docs/superpowers/plans/`）：核心解析 → Schema/校验 → 校验器/YAML → fixture 工作台 → live LLM → 分析/规划强化 → 生成校验回灌 → 解析边界/TXT 上传。
- 主分支始终保持可运行；提交遵循 TDD（先测试后实现），每个模块独立提交。
- 不提交任何密钥；只提交 `.env.example`。

## 边界（v1）

不含：登录/数据库/多用户、DOCX/PDF 解析、复杂排版、强制云部署。聚焦：**中文小说 → 可追溯 YAML 短剧分场剧本 → 可编辑可校验**。
