# Novel2Script

Novel2Script is a local workbench for turning a Chinese novel excerpt into a traceable screenplay YAML draft. The current P0 build runs fully offline with a built-in original demo novel and deterministic fixtures.

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

Live LLM generation is intentionally left for the next plan. Fixture mode only returns results for the built-in demo fingerprint and never maps arbitrary custom text to the demo script.

## Requirements

- Node.js 20+
- npm

## Setup

```bash
npm install
```

Optional environment file:

```bash
copy .env.example .env.local
```

For this P0 fixture build, no API key is required.

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
