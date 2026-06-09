# Coding Conventions

**Analysis Date:** 2026-06-09

## Overview

This is a content-only Cinatra agent extension repo. It ships no TypeScript source files of its own — only a self-contained CI gate script (`extension-kind-gate.mjs`), an agent spec (`cinatra/oas.json`), and a skill definition (`skills/email-delivery/SKILL.md`). Conventions below reflect both the gate script and the agent authoring patterns in this repo.

## Naming Patterns

**Files:**
- Agent spec: `cinatra/oas.json` — canonical location for all agent extensions
- Skill definition: `skills/<skill-name>/SKILL.md` — kebab-case skill directory name
- Gate script: `extension-kind-gate.mjs` — kebab-case, `.mjs` extension for ESM
- Workflows: `cinatra/workflow.bpmn` — fixed name, single sidecar only

**Functions (in `extension-kind-gate.mjs`):**
- camelCase: `parseArgs`, `validateAgent`, `validateWorkflow`, `runGate`, `walkLlmStrings`, `scanOasString`, `findWorkflowSidecars`, `validateWorkflowPackageShape`, `validateBpmnSanity`
- Verb-noun pattern: `validate*`, `find*`, `scan*`, `walk*`, `run*`

**Variables:**
- camelCase throughout: `packageRoot`, `oasPath`, `bpmnPath`, `bpmnPrefixes`, `openTags`
- Constants: SCREAMING_SNAKE_CASE for module-level constants: `LLM_VISIBLE_FIELDS`, `BANNED_PRIMITIVES`, `BANNED_TYPEHINTS`, `PRIMITIVE_PATTERNS`, `BPMN_MODEL_NS`, `WORKFLOW_PACKAGE_NAME_RE`

**Types:**
- No TypeScript sources; the gate script is plain JavaScript (`.mjs`)
- OAS JSON uses `camelCase` for field names: `component_type`, `$component_ref` are exceptions (snake_case) matching the pyagentspec schema

## Code Style

**Formatting:**
- Not detected (no `.prettierrc`, `.eslintrc`, or `biome.json` present)
- Indentation: 2 spaces (observed in `extension-kind-gate.mjs`)
- String quotes: double quotes for strings

**Linting:**
- Not detected — no ESLint or Biome config present
- CI runs `node extension-kind-gate.mjs --package-root .` as the sole lint-equivalent gate

## Module System

**Format:** ESM (`"type": "module"` in `package.json`)
- Gate script uses named `import` from `node:fs`, `node:path`
- All exports from `extension-kind-gate.mjs` are named exports (`export function ...`)
- Entry-point guard pattern:
  ```js
  const invokedDirectly =
    process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
  if (invokedDirectly) { main(); }
  ```
  Enables the file to be both `import`ed (for testing) and run directly as a CLI.

## Import Organization

**Order (in `extension-kind-gate.mjs`):**
1. Node built-ins only (`node:fs`, `node:path`)
- No third-party or first-party imports (zero-dependency constraint is intentional)

**Path Aliases:** None

## Error Handling

**Pattern:** Pure functions return `string[]` errors rather than throwing.
- `validateAgent(packageRoot)` → `string[]`
- `validateWorkflow(packageRoot)` → `string[]`
- `validateBpmnSanity(xml)` → `string[]`
- `validateWorkflowPackageShape(pkg)` → `string[]`
- `runGate(packageRoot)` → `{ kind, errors: string[] }`

**Caller pattern:** `errors.push(...validateX(...))` — accumulate, never throw
- File I/O errors are caught with try/catch and pushed as error strings, then early-return
- Exit codes: `process.exit(0)` clean, `process.exit(1)` violations (only in `main()`)

**Agent error handling (in SKILL.md):**
- On fetch failure: return `{ "sendResult": { "status": "failed", "errorCode": "OBJECTS_FETCH_FAILED", ... } }`
- On poll timeout: return `sendResult.status: "failed"` with `errorCode: "POLL_BUDGET_EXHAUSTED"`
- Max retries: 5 poll iterations (bridge enforces `max_steps: 10`)

## Logging

**Framework:** `console.log` / `console.error` (no logging library)

**Patterns:**
- Success: `console.log("✓ extension-kind-gate: ...")` to stdout
- Violations: `console.error("✗ extension-kind-gate: ...")` with bullet list to stderr
- Unexpected errors caught in main: `console.error("extension-kind-gate: unexpected error", err)`

## Comments

**When to Comment:**
- Section headers using `// ---` divider lines to separate logical sections
- Inline `//` comments explain non-obvious logic (regex choices, namespace resolution rationale)
- Long block comments above classes/functions when external callers need contract info (e.g., `/** Validate an agent extension... Pure: returns string[] errors. */`)

**JSDoc/TSDoc:**
- JSDoc-style `/** */` used on exported functions in the gate script
- Not enforced by a linter

## Function Design

**Size:** Functions are focused and single-purpose; most are 10–40 lines
**Parameters:** Simple values (strings, objects) — no complex parameter objects
**Return Values:** Pure functions return `string[]` (errors) or structured objects; no exceptions thrown for validation failures

## Agent Authoring Conventions (SKILL.md / cinatra/oas.json)

- SKILL.md is the authoritative LLM prompt; it uses numbered STEP headings
- Agent outputs are plain JSON objects — no prose, no Markdown wrapping
- Input fields use camelCase UUIDs for object references (`approvedDraftBundleRef`, `confirmedRecipientsRef`)
- `agent_run_id` is always present with `default: ""` — never required from the operator
- `riskClass` is declared on ApiNode metadata: `"email_send"`
- `toolboxes` is intentionally OMITTED from ApiNode metadata to use the default inject path

---

*Convention analysis: 2026-06-09*
