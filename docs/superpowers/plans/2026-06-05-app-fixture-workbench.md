# Fixture Workbench App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the P0 demo app layer: a local Next.js workbench that runs the built-in fixture novel through parse, analyze, plan, generate, YAML validation, and quality reporting.

**Architecture:** Keep `src/core` deterministic and framework-free. Add `src/llm` provider interfaces plus a fixture-only provider, then use thin Next.js Route Handlers under `src/app/api` to compose core functions and provider results. The UI is a single workbench screen that calls those routes and displays input, intermediate data, editable YAML, validation findings, and quality report.

**Tech Stack:** Next.js App Router, React, TypeScript, lucide-react, existing Zod/YAML/Vitest core.

---

## File Structure

| File | Responsibility |
|---|---|
| `fixtures/demo-novel.txt` | Original 3-chapter demo novel. |
| `fixtures/demo-analysis.json` | Fixture analyze result with deterministic entity IDs. |
| `fixtures/demo-plan.json` | Fixture scene plan. |
| `fixtures/demo-script.json` / `.yaml` | Fixture final screenplay with valid IDs and fingerprint. |
| `src/llm/provider.ts` | Provider/result types. |
| `src/llm/fixture-provider.ts` | Demo-fingerprint-gated fixture provider. |
| `src/core/validate/repair.ts` | Generate-path source-ref stripping. |
| `src/core/validate/full.ts` | Composition of schema, referential, anchor, constraints, quality report, weak traceability. |
| `src/app/api/*/route.ts` | Route Handlers for parse/analyze/plan/generate/validate-yaml. |
| `src/app/page.tsx` | Minimal workbench UI. |
| `tests/integration/fixture-pipeline.test.ts` | Fixture full-chain integration coverage. |

## Tasks

- [ ] Add Next/React/lucide dependencies and Next TypeScript config.
- [ ] Add original demo fixtures and ensure IDs/fingerprint match parser output.
- [ ] Add fixture provider and provider contracts.
- [ ] Add full validation orchestration and generate-path repair.
- [ ] Add API Route Handlers.
- [ ] Add a usable workbench UI as the first screen.
- [ ] Add fixture integration tests.
- [ ] Verify with `npm test`, `npm run typecheck`, `npm run build`, and local `npm run dev`.

## Plan 4 Scope Boundaries

Plan 4 intentionally does not call a live LLM. `LiveLLMProvider`, retry/degradation logic, richer YAML editor behavior, exports, and demo video remain Plan 5/P1. Plan 4 must still provide a complete no-key demo path with strict fixture gating so custom text is never silently mapped to the demo script.
