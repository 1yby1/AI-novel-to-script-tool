# Novel2Script

Novel2Script is a local workbench for turning a Chinese novel into a traceable screenplay YAML draft. It runs fully offline with a built-in original demo novel + deterministic fixtures, and—when an OpenAI-compatible API key is configured—generates screenplays from arbitrary custom novels via a live LLM.

## What Works Now

- Parse novel text into chapters and stable paragraph IDs.
- Normalize character/location entities into deterministic IDs.
- Validate screenplay YAML with Zod structure checks, referential checks, source anchoring, short-drama constraints, and recomputed quality reports.
- Run the built-in fixture pipeline through a Next.js workbench:
  - parse
  - analyze
  - plan
  - generate YAML
  - edit and revalidate YAML

Live LLM generation is supported: set an OpenAI-compatible `OPENAI_API_KEY` and custom novels are turned into a screenplay by the live model (analyze → plan → generate, with structured-output validation + retry, and the deterministic core still owning IDs/anchoring/validation). Without a key the workbench runs the built-in demo offline; fixture mode only returns results for the built-in demo fingerprint and never maps arbitrary custom text to the demo script.

## Requirements

- Node.js 20+
- npm

## Setup

```bash
npm install
```

Optional — enable live generation for custom novels:

```bash
copy .env.example .env.local
```

Set `OPENAI_API_KEY` (any OpenAI-compatible key). Optional: `OPENAI_BASE_URL` (e.g. a Qwen/DeepSeek endpoint), `MODEL_NAME` (default `gpt-4o-mini`), `OPENAI_TIMEOUT_MS`, `LLM_MAX_RETRIES`. Set `DEMO_MODE=fixture` to force the offline demo even with a key. Without a key, the built-in demo runs offline (no key required).

## Run

```bash
npm run dev
```

Open the local URL printed by Next.js, usually:

```text
http://localhost:3000
```

In the workbench, load the demo, then run Parse, Analyze, Plan, Generate, and Validate.

## Verify

```bash
npm test
npm run typecheck
npm run build
```

## Fixtures

The demo fixtures live in `fixtures/`:

- `demo-novel.txt` is original project text.
- `demo-analysis.json` contains fixture entity/event analysis.
- `demo-plan.json` contains fixture episode and scene planning.
- `demo-script.json` and `demo-script.yaml` contain the generated screenplay.

The demo source fingerprint is `68d7c2e2e2ec7e59`.

## Third-Party Dependencies

- Next.js and React for the local workbench.
- Zod for structural schema validation.
- yaml for YAML parse/stringify.
- lucide-react for UI icons.
- Vitest for tests.

## Original Implementation

The deterministic core is implemented in this repository:

- text normalization and chapter parsing
- stable paragraph IDs
- deterministic entity IDs
- entity normalization
- screenplay schema
- referential, anchor, constraint, and quality-report validators
- YAML conversion
- fixture-only provider and workbench API orchestration
