<!-- refreshed: 2026-06-09 -->
# Architecture

**Analysis Date:** 2026-06-09

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│              Upstream Orchestrator (@cinatra-ai/email-outreach-agent)│
│              Provides: campaignId, senderEmail,                      │
│              approvedDraftBundleRef, confirmedRecipientsRef          │
└────────────────────────────┬────────────────────────────────────────┘
                             │ agent_run (4 inputs)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    WayFlow Flow: email-delivery-flow                 │
│                    `cinatra/oas.json`                                │
│                                                                      │
│  ┌──────────┐     ┌────────────────────────────────┐   ┌─────────┐  │
│  │ StartNode│────▶│ ApiNode "send"                 │──▶│ EndNode │  │
│  │ (Inputs) │     │ POST /api/llm-bridge           │   │(Output) │  │
│  └──────────┘     │ agent_id: email-delivery-agent │   └─────────┘  │
│                   │ max_steps: 10                  │                │
│                   │ LLM: openai / gpt-5.5          │                │
│                   └──────────────┬─────────────────┘                │
└──────────────────────────────────│──────────────────────────────────┘
                                   │ LLM executes SKILL.md steps
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│               Cinatra LLM Bridge (/api/llm-bridge)                  │
│               Cinatra self-MCP injected automatically               │
│                                                                      │
│  tools: objects_get, email_outreach_send_initial_start,             │
│         email_outreach_send_initial_status                           │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Flow manifest (OAS) | Declares WayFlow graph: nodes, control-flow & data-flow edges, inputs/outputs | `cinatra/oas.json` |
| StartNode | Accepts and validates the four required inputs | `cinatra/oas.json` (`$referenced_components.start`) |
| ApiNode "send" | Issues POST to `/api/llm-bridge`; LLM executes SKILL.md steps within `max_steps: 10` | `cinatra/oas.json` (`$referenced_components.send`) |
| EndNode | Emits `sendResult` as flow output | `cinatra/oas.json` (`$referenced_components.end`) |
| SKILL.md | Authoritative step-by-step agent instructions loaded by the LLM bridge | `skills/email-delivery/SKILL.md` |
| extension-kind-gate | Self-contained CI gate: validates OAS is parseable and contains no retired CRM primitives | `extension-kind-gate.mjs` |

## Pattern Overview

**Overall:** Declarative LLM-bridge agent — a WayFlow `Flow` that contains a single `ApiNode` posting to an LLM bridge endpoint. The LLM, guided by `SKILL.md`, orchestrates tool calls against the Cinatra self-MCP to execute the email send.

**Key Characteristics:**
- No server-side business logic code in this repo; all execution logic lives in the LLM prompt (`SKILL.md`) and the upstream bridge/runtime.
- Three-node linear graph: StartNode → ApiNode → EndNode (no branches, no loops, no HITL within the flow).
- riskClass `email_send` declared on the ApiNode; upstream orchestrator owns all pre-send HITL.

## Layers

**Flow Definition Layer:**
- Purpose: Describes the WayFlow graph structure (nodes, data-flow wiring, inputs/outputs) consumed by the WayFlow runtime.
- Location: `cinatra/oas.json`
- Contains: StartNode, ApiNode, EndNode definitions and their connections.
- Depends on: WayFlow runtime (external, not in repo).
- Used by: WayFlow runtime to mount and execute the agent.

**Agent Instruction Layer:**
- Purpose: Natural-language step-by-step instructions for the LLM executing inside the ApiNode.
- Location: `skills/email-delivery/SKILL.md`
- Contains: Steps for resolving object refs, calling send use cases, polling for completion, returning `sendResult`.
- Depends on: Cinatra self-MCP tools (`objects_get`, `email_outreach_send_initial_start`, `email_outreach_send_initial_status`).
- Used by: LLM bridge (`/api/llm-bridge`) via `data.system` in the ApiNode configuration.

**CI Gate Layer:**
- Purpose: Standalone, zero-dependency validation of the OAS manifest for retired CRM primitives and basic parseability.
- Location: `extension-kind-gate.mjs`
- Contains: `validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `runGate` functions.
- Depends on: Node.js builtins only (no `@cinatra-ai/*` packages).
- Used by: `.github/workflows/ci.yml` (`kind-gates` job).

## Data Flow

### Primary Request Path

1. Upstream orchestrator calls `agent_run` with `campaignId`, `senderEmail`, `approvedDraftBundleRef`, `confirmedRecipientsRef` → enters **StartNode** (`cinatra/oas.json` `$referenced_components.start`).
2. All four inputs are wired via `DataFlowEdge` to **ApiNode "send"** (`cinatra/oas.json` `$referenced_components.send`).
3. ApiNode POSTs to `/api/llm-bridge` with a system prompt referencing `SKILL.md` and a user prompt injecting the four runtime values.
4. LLM calls `objects_get` twice to resolve `approvedDraftBundleRef` → `drafts[]` and `confirmedRecipientsRef` → `recipients[]`.
5. LLM calls `email_outreach_send_initial_start` with the four inputs → receives `operationId`.
6. LLM polls `email_outreach_send_initial_status` (up to 5 iterations) until `status === "completed"` or `status === "failed"`.
7. LLM returns `sendResult` JSON object → flows via `DataFlowEdge` `send_sendResult_to_end` to **EndNode**.
8. EndNode emits `sendResult` as flow output back to the orchestrator.

### Error Path

- If `objects_get` fails → LLM returns `{ sendResult: { status: "failed", errorCode: "OBJECTS_FETCH_FAILED", ... } }`.
- If poll budget exhausted (5 iterations) → LLM returns `{ sendResult: { status: "failed", errorCode: "POLL_BUDGET_EXHAUSTED" } }`.
- If `max_steps: 10` exceeded → WayFlow returns control to caller with no terminal status (treated as failure).

**State Management:**
- No local state. All state is held by the LLM bridge conversation within a single `agent_run` invocation. Results are stateless JSON outputs.

## Key Abstractions

**WayFlow Flow:**
- Purpose: A directed graph of typed nodes connected by control-flow and data-flow edges, executed by the WayFlow runtime.
- Examples: `cinatra/oas.json`
- Pattern: Declarative JSON manifest (`agentspec_version: 26.1.0`, `component_type: Flow`).

**ApiNode:**
- Purpose: A flow node that issues an HTTP call (here: POST to `/api/llm-bridge`) and extracts typed outputs from the response.
- Examples: `cinatra/oas.json` (`$referenced_components.send`)
- Pattern: Declares `url`, `http_method`, `data` (containing LLM prompt), and typed `inputs`/`outputs`.

**SKILL.md:**
- Purpose: Authoritative instruction document loaded by the LLM. Defines steps, error codes, polling caps, output schema, and known limitations.
- Examples: `skills/email-delivery/SKILL.md`
- Pattern: Markdown with numbered steps, JSON code blocks for request/response shapes, and a "Known limitations" section.

## Entry Points

**WayFlow Runtime Mount:**
- Location: `cinatra/oas.json` (`start_node.$component_ref: "start"`)
- Triggers: `agent_run` call from upstream orchestrator or standalone operator invocation.
- Responsibilities: Validates required inputs (`campaignId`, `approvedDraftBundleRef`, `confirmedRecipientsRef`, `senderEmail`); `agent_run_id` is hidden with a default of `""`.

**CI Gate:**
- Location: `extension-kind-gate.mjs` (`main()` function, line 365)
- Triggers: `node extension-kind-gate.mjs --package-root .` in `.github/workflows/ci.yml`.
- Responsibilities: Reads `cinatra/oas.json`, scans LLM-visible strings (`system`, `user`, `description` fields) for banned CRM primitives and legacy type hints, exits 0 (pass) or 1 (violations found).

## Architectural Constraints

- **Threading:** Not applicable — no application server. Execution is driven by the external WayFlow runtime over HTTP.
- **Global state:** None — this repo ships no runtime code beyond the CI gate script.
- **Circular imports:** Not applicable — no module graph in this repo (only `extension-kind-gate.mjs`, which uses Node builtins only).
- **max_steps cap:** The ApiNode enforces `max_steps: 10` on the LLM bridge session. The SKILL.md limits polling to 5 iterations to stay within this budget.
- **Stubbed send use cases:** `email_outreach_send_initial_start` and `email_outreach_send_initial_status` are currently not implemented in the upstream `src/lib/trigger-email-send-use-cases.ts` (not in this repo). Attempts to send will fail at STEP 2 with a propagated "not implemented" error.
- **No FlowNode / TriggerWaitNode:** Both are intentionally absent. `FlowNode` requires a `subflow` field; `TriggerWaitNode` is not yet a real pyagentspec component. Omitting them keeps the WayFlow `/.health` endpoint green.
- **Dev-mode redirect:** All sends in the upstream bridge route through `sendEmailThroughSystem` (in `src/lib/email-system.ts`, not in this repo), which applies the `forwardingDestination` override in dev mode.

## Anti-Patterns

### Direct `sendGmailMessage` Import

**What happens:** Importing `sendGmailMessage` directly in bridge-side code bypasses the dev-mode redirect.
**Why it's wrong:** The `forwardingDestination` chokepoint in `sendEmailThroughSystem` is skipped, causing emails to be sent to real recipients in dev mode.
**Do this instead:** All sends must route through `sendEmailThroughSystem` (upstream `src/lib/email-system.ts`), not direct `sendGmailMessage` imports.

### Adding HITL Nodes to This Flow

**What happens:** Adding a `TriggerWaitNode` or sender-picker `HitlNode` to `cinatra/oas.json`.
**Why it's wrong:** `TriggerWaitNode` is not yet a real pyagentspec component and will prevent the agent from mounting. Sender HITL belongs in the upstream orchestrator.
**Do this instead:** Keep the flow as a single ApiNode. Add trigger/wait machinery only after `TriggerWaitNode` is available as a real component.

## Error Handling

**Strategy:** LLM-level error handling — the LLM is instructed (via SKILL.md) to catch fetch failures and poll budget exhaustion and encode them as structured `sendResult` JSON with `status: "failed"` and an `errorCode`.

**Patterns:**
- `OBJECTS_FETCH_FAILED` — returned immediately if either `objects_get` call fails.
- `POLL_BUDGET_EXHAUSTED` — returned if `email_outreach_send_initial_status` does not reach a terminal state within 5 polls.
- No try/catch in this repo's code (the CI gate uses `try/catch` only for file I/O in `extension-kind-gate.mjs`).

## Cross-Cutting Concerns

**Logging:** Not applicable — no server runtime. The LLM bridge handles logging externally.
**Validation:** CI gate (`extension-kind-gate.mjs`) validates `cinatra/oas.json` for retired primitives. Input schema validation is owned by the WayFlow runtime via the `StartNode` input declarations.
**Authentication:** Not in scope for this repo. Authentication to `/api/llm-bridge` is managed by the WayFlow runtime and the upstream Cinatra platform.

---

*Architecture analysis: 2026-06-09*
