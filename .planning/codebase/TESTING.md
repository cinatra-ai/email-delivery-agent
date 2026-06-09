# Testing Patterns

**Analysis Date:** 2026-06-09

## Overview

This is a content-only Cinatra agent extension repo with no TypeScript sources and no application test suite. The sole testable artifact is `extension-kind-gate.mjs`, which is a self-contained, zero-dependency JavaScript validation script. All testing and typechecking for the underlying agent implementation lives in the cinatra monorepo.

## Test Framework

**Runner:** Not applicable for this standalone repo — no test runner configured (`package.json` has no `scripts.test` field).

**Assertion Library:** Not applicable.

**Run Commands:**
```bash
# No test suite in this repo.
# CI skips standalone tests for repos with host-internal @cinatra-ai/* peers:
# "Skipping standalone tests (host-internal @cinatra-ai/* peers — the cinatra monorepo runs these)."

# The only runtime-validation command that runs in CI:
node extension-kind-gate.mjs --package-root .
```

## CI Gate (Functional Equivalent of Tests)

The CI pipeline in `.github/workflows/ci.yml` acts as the quality gate. It runs two jobs:

**`build` job:**
1. Classifies the repo (source mirror vs standalone)
2. Skips install/typecheck/test since the repo declares host-internal `@cinatra-ai/*` peers
3. Runs `npm pack --dry-run` to validate package shape

**`kind-gates` job:**
- Runs `node extension-kind-gate.mjs --package-root .`
- Validates `cinatra/oas.json` parses as valid JSON
- Scans all LLM-visible string fields (`system`, `user`, `description`) for retired CRM primitives
- Banned primitives: `lists_*`, `accounts_*`, `contacts_*`, `contacts_sources_list`
- Banned type hints: `@cinatra-ai/entity-accounts:account`, `@cinatra-ai/entity-contacts:contact`

## Test File Organization

**Location:** No test files exist in this repo.

**Naming:** Not applicable.

## Gate Script Design (Testable Unit)

`extension-kind-gate.mjs` is designed for testability — it exports all validation functions as named exports and uses an `invokedDirectly` guard so the file can be `import`ed without side effects:

```js
export function validateAgent(packageRoot) { /* ... */ }
export function validateWorkflow(packageRoot) { /* ... */ }
export function validateBpmnSanity(xml) { /* ... */ }
export function validateWorkflowPackageShape(pkg) { /* ... */ }
export function findWorkflowSidecars(packageRoot) { /* ... */ }
export function parseArgs(argv) { /* ... */ }
export function runGate(packageRoot) { /* ... */ }
```

All validation functions are pure (no side effects beyond file reads): they accept inputs and return `string[]` of error messages.

## Mocking

**Framework:** Not applicable — no test runner.

**What the gate script reads at runtime:**
- `package.json` — read with `readFileSync`
- `cinatra/oas.json` — read with `readFileSync`
- `cinatra/workflow.bpmn` — read with `readFileSync`

To unit-test the gate functions in isolation, the pure functions (`validateBpmnSanity`, `validateWorkflowPackageShape`, `scanOasString`, `walkLlmStrings`) require no mocking — they accept raw strings/objects. File-reading functions (`validateAgent`, `validateWorkflow`, `runGate`) would require filesystem fixtures or mocked `fs`.

## Fixtures and Factories

**Test Data:** Not applicable — no test suite.

The gate script itself defines inline test data (banned primitives list, namespace URIs) as module-level constants in `extension-kind-gate.mjs`.

## Coverage

**Requirements:** Not enforced — no coverage tooling configured.

**View Coverage:** Not applicable.

## Test Types

**Unit Tests:** Not present. The exported functions in `extension-kind-gate.mjs` are designed for unit testing (pure functions, small surface) but no tests are written.

**Integration Tests:** Not present. The CI gate (`node extension-kind-gate.mjs --package-root .`) serves as an integration check against the real repo artifacts.

**E2E Tests:** Not used. Agent end-to-end testing (triggering `agent_run`, polling for completion) is delegated to the cinatra monorepo and WayFlow runtime.

## Agent Behavior Validation

The agent's send behavior (`email_outreach_send_initial_start`, `email_outreach_send_initial_status`) is explicitly noted as stubbed:

> "Both `email_outreach_send_initial_start` and `email_outreach_send_initial_status` throw `not implemented` in `src/lib/trigger-email-send-use-cases.ts`."

This means:
- `agent_run` against this agent will fail at STEP 2 with a "not implemented" error
- That failure is documented as correct constrained behavior until the monorepo use cases land
- No workaround or test harness exists in this repo for the stubbed behavior

---

*Testing analysis: 2026-06-09*
