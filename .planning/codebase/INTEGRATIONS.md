# External Integrations

**Analysis Date:** 2026-06-09

## APIs & External Services

**Cinatra LLM Bridge:**
- `{{CINATRA_BASE_URL}}/api/llm-bridge` — the single HTTP endpoint the `ApiNode` calls (POST); it routes the prompt to the configured LLM and injects the Cinatra self-MCP toolbox
  - SDK/Client: raw HTTP via `ApiNode` in `cinatra/oas.json`
  - Auth: runtime-injected (managed by WayFlow host)

**Email Send Use Cases (Cinatra internal):**
- `email_outreach_send_initial_start` — tool injected via the Cinatra self-MCP; initiates the batch send and returns an `operationId`
- `email_outreach_send_initial_status` — tool injected via the Cinatra self-MCP; polled (up to 5 times) until `status === "completed"` or `status === "failed"`
- Both are currently stubbed (`not implemented`) in the monorepo at `src/lib/trigger-email-send-use-cases.ts` (monorepo path, not present in this repo)

**Object Store (Cinatra internal):**
- `objects_get` — tool injected via the Cinatra self-MCP; used to resolve `approvedDraftBundleRef` → drafts array and `confirmedRecipientsRef` → recipients array

## Data Storage

**Databases:**
- Not applicable — this agent holds no local state; all persistent data (draft bundles, recipient lists) are resolved at runtime via `objects_get` using UUID references

**File Storage:**
- Local filesystem only — no external file-storage integration

**Caching:**
- None

## Authentication & Identity

**Auth Provider:**
- Managed by WayFlow / Cinatra host — the agent itself carries no auth credentials; the LLM bridge and MCP tools authenticate via the workspace session established by the Cinatra runtime

## Email Provider

**Gmail:**
- The underlying send pipeline (`sendEmailThroughSystem` / `sendGmailMessage`) routes messages through Gmail
- Dev-mode redirect: `sendEmailThroughSystem` (monorepo `src/lib/email-system.ts`) acts as the single chokepoint; all sends pass through it so the `forwardingDestination` override can intercept in dev mode
- This agent does not call Gmail directly — it calls `email_outreach_send_initial_start` which internally drives the Gmail integration

## Upstream Orchestrator

**`@cinatra-ai/email-outreach-agent`:**
- Invokes this agent via `agent_run` and provides all four required inputs: `campaignId`, `approvedDraftBundleRef`, `confirmedRecipientsRef`, `senderEmail`
- This agent can also be invoked standalone for testing

## Monitoring & Observability

**Error Tracking:**
- Not detected — no error-tracking SDK present

**Logs:**
- Handled by the Cinatra WayFlow runtime; this agent emits no custom logging

## CI/CD & Deployment

**Hosting:**
- Cinatra WayFlow runtime (production); agent is mounted via `cinatra/oas.json`

**CI Pipeline:**
- GitHub Actions — `.github/workflows/ci.yml` (build + kind-gates jobs), `.github/workflows/release.yml`
- CI gate: `extension-kind-gate.mjs` scans `cinatra/oas.json` for retired agentspec primitives on every push/PR to `main`

## Environment Configuration

**Required env vars:**
- `CINATRA_BASE_URL` — injected at runtime into the `ApiNode` URL template; must resolve to the active Cinatra instance

**Secrets location:**
- `.npmrc` present (existence only, contents not read); no `.env` files detected in this repo

## Webhooks & Callbacks

**Incoming:**
- None — the agent is invoked via `agent_run` (Cinatra internal RPC), not via HTTP webhook

**Outgoing:**
- None directly; the Cinatra LLM bridge manages downstream callbacks to the email provider

## HITL (Human-in-the-Loop) Screens

**Output renderer:**
- `@cinatra-ai/email-delivery-agent:output` — registered as a HITL screen in `cinatra/oas.json` metadata; rendered by the Cinatra UI after the `ApiNode` completes
- `requiresApproval: false` — send executes without a human approval gate in this constrained shape

---

*Integration audit: 2026-06-09*
