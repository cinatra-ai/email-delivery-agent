# Codebase Concerns

**Analysis Date:** 2026-06-09

## Tech Debt

**Core send use cases are stubbed — agent does not deliver email end-to-end:**
- Issue: Both `email_outreach_send_initial_start` and `email_outreach_send_initial_status` throw `not implemented` in `src/lib/trigger-email-send-use-cases.ts` (referenced in `skills/email-delivery/SKILL.md`). The agent mounts in WayFlow but any real `agent_run` fails at STEP 2 with a propagated "not implemented" error.
- Files: `skills/email-delivery/SKILL.md` (Known limitations section), `cinatra/oas.json`
- Impact: The agent is non-functional for its stated purpose — it cannot send email to anyone. All downstream orchestrators that invoke this agent via `agent_run` will receive a failure result.
- Fix approach: Implement `email_outreach_send_initial_start` and `email_outreach_send_initial_status` in the referenced `src/lib/trigger-email-send-use-cases.ts` file. The agent SKILL.md already defines the full calling contract.

**`TriggerWaitNode` and trigger/wait machinery intentionally absent:**
- Issue: The constrained agent shape omits `FlowNode` and `TriggerWaitNode` because `TriggerWaitNode` is not yet a real pyagentspec component. This means sender HITL and trigger subflow logic are stripped from the agent, reducing its operational safety (no human-in-the-loop on the send step).
- Files: `skills/email-delivery/SKILL.md` (Architecture context section), `cinatra/oas.json` (ApiNode metadata description)
- Impact: Emails are dispatched without a trigger-wait safety gate. If the upstream orchestrator mis-calls this agent, there is no secondary approval layer.
- Fix approach: Re-introduce `TriggerWaitNode`, `FlowNode` with a `subflow` field, and sender HITL screens once the pyagentspec runtime provides those primitives.

**`tsconfig.json` targets a `src/` directory that does not exist:**
- Issue: `tsconfig.json` declares `"rootDir": "src"` and `"include": ["src/**/*.ts", "src/**/*.tsx"]`, but the repo has no `src/` directory — only `skills/`, `cinatra/`, and root-level files. The config references `src/lib/trigger-email-send-use-cases.ts` and `src/lib/email-system.ts` (per SKILL.md) but those files are absent from the extracted repo.
- Files: `tsconfig.json`
- Impact: Running `tsc` against this repo produces TS18003 "No inputs were found." The CI correctly skips standalone typecheck for source-mirror repos, masking this structural gap. If `src/` is ever added, the tsconfig is ready — but currently misleading.
- Fix approach: Either add the `src/` sources that the SKILL.md references, or document that this is a content-only agent extension and remove the `src/` tsconfig stubs.

**`requiresApproval: false` on a `riskClass: email_send` node:**
- Issue: In `cinatra/oas.json`, the `send` ApiNode is marked `riskClass: "email_send"` but `requiresApproval: false`. A high-risk operation (bulk email send) bypasses approval gates entirely.
- Files: `cinatra/oas.json` (send node metadata, lines 268–269)
- Impact: No platform-level approval prompt is shown before emails are dispatched. The SKILL.md notes the agent is "Do NOT pause for confirmation" by design, relying on the upstream orchestrator to have already approved — but there is no enforcement mechanism in this agent's OAS to verify that upstream approval actually occurred.
- Fix approach: Evaluate whether `requiresApproval: true` should be set for the send node as a defense-in-depth measure, or add explicit input validation that upstream approval refs are non-empty before calling the send use case.

**Poll budget is hard-coded and low:**
- Issue: The SKILL.md mandates capping retries to FIVE iterations for polling `email_outreach_send_initial_status`, with the bridge enforcing `max_steps: 10`. For large campaigns with slow send pipelines this budget may be exhausted before the operation completes, resulting in `POLL_BUDGET_EXHAUSTED` failures that are indistinguishable from real delivery failures.
- Files: `skills/email-delivery/SKILL.md` (STEP 3), `cinatra/oas.json` (`max_steps: 10`)
- Impact: Large campaigns may always time out at the agent level even when the underlying send is progressing normally.
- Fix approach: Expose a configurable poll timeout or increase `max_steps` headroom; make `POLL_BUDGET_EXHAUSTED` clearly distinguishable in the return `sendResult` so callers can retry safely.

## Known Bugs

**Agent fails on every real invocation due to stubbed use cases:**
- Symptoms: `agent_run` against this agent always returns `sendResult.status: "failed"` with a propagated "not implemented" error at STEP 2.
- Files: `skills/email-delivery/SKILL.md` (Known limitations), `cinatra/oas.json`
- Trigger: Any invocation of the agent when the underlying use cases are not implemented.
- Workaround: None. This is documented as correct constrained behavior until the use cases land.

## Security Considerations

**`.npmrc` present — existence noted:**
- Risk: The `.npmrc` file exists at the repo root. Its contents were not read. If it contains registry auth tokens or credentials, committing it to a public extracted repo would expose those tokens.
- Files: `.npmrc`
- Current mitigation: Unknown without reading the file.
- Recommendations: Ensure `.npmrc` contains only registry URL configuration (e.g., `@cinatra-ai:registry=...`) and no auth tokens. Auth tokens should be injected via CI environment variables, not committed files.

**No input validation in agent instructions — relies entirely on upstream trust:**
- Risk: The SKILL.md instructs the agent to "Do NOT re-validate drafts/recipients/sender (that already happened upstream)." The agent accepts `approvedDraftBundleRef` and `confirmedRecipientsRef` as opaque UUIDs and passes them directly to the send use case without any local verification.
- Files: `skills/email-delivery/SKILL.md` (STEP 1), `cinatra/oas.json`
- Current mitigation: The `objects_get` calls in STEP 1 provide a soft fetch-failure gate (`OBJECTS_FETCH_FAILED`).
- Recommendations: At minimum, verify that the fetched `drafts[]` and `recipients[]` arrays are non-empty before calling the send use case, to prevent accidental empty sends.

**`senderEmail` is passed as plain string with no format validation in OAS:**
- Risk: The `senderEmail` input is typed as `"type": "string"` in the OAS with no `format: "email"` constraint (unlike `campaignId` which has `format: "uuid"`). A malformed or injected sender address could cause unexpected behavior downstream.
- Files: `cinatra/oas.json` (StartNode inputs, line 213; send node inputs)
- Current mitigation: None at the OAS layer.
- Recommendations: Add `"json_schema": { "format": "email" }` to the `senderEmail` input schema in `cinatra/oas.json`.

## Performance Bottlenecks

**Polling loop is synchronous within a single LLM agent run:**
- Problem: STEP 3 polling runs as sequential LLM tool calls within the agent's `max_steps: 10` budget. Each poll iteration consumes one or more steps, leaving little headroom for the actual send and fetch operations.
- Files: `cinatra/oas.json` (`max_steps: 10`), `skills/email-delivery/SKILL.md` (STEP 3)
- Cause: The pyagentspec ApiNode pattern does not support async webhooks or native wait primitives in this constrained shape.
- Improvement path: When `TriggerWaitNode` becomes available, replace the polling loop with a proper trigger/wait pattern to avoid burning the step budget on polling.

## Fragile Areas

**`cinatra/oas.json` is the only runtime artifact — any schema drift breaks mounting:**
- Files: `cinatra/oas.json`
- Why fragile: The entire agent behavior (flow topology, tool prompts, LLM configuration, risk class) is encoded in a single 289-line JSON file. Any invalid JSON, schema incompatibility with the target `agentspec_version: "26.1.0"`, or drift in the Cinatra platform's OAS contract will prevent the agent from mounting in WayFlow.
- Safe modification: Run `node extension-kind-gate.mjs --package-root .` after any edit to validate the OAS against the banned-primitives gate. Full schema validation only runs marketplace-side at publish.
- Test coverage: The CI `kind-gates` job runs the OAS gate, but does NOT validate the full pyagentspec schema contract.

**LLM prompt encodes all operational logic — no source-controlled SKILL.md sync guarantee:**
- Files: `cinatra/oas.json` (send node `system` field, line 230), `skills/email-delivery/SKILL.md`
- Why fragile: The system prompt in the OAS refers to "Follow SKILL.md step-by-step" but the OAS `system` field and `SKILL.md` can diverge silently. There is no automated check that the two stay in sync; a SKILL.md update does not automatically update the OAS prompt.
- Safe modification: Treat the OAS `system` and `user` fields as the authoritative runtime instructions. Update both files together when changing agent behavior.
- Test coverage: No test covers prompt/SKILL.md consistency.

## Scaling Limits

**Batch send is opaque to the agent — no per-recipient failure handling:**
- Current capacity: The agent calls `email_outreach_send_initial_start` once for the entire campaign and reports aggregate `totalSent` / `totalFailed` counts.
- Limit: Partial failures (e.g., some recipients bounce, others succeed) are collapsed into a single `sendResult` object with no per-recipient detail surfaced by this agent.
- Scaling path: The underlying use case (`src/lib/trigger-email-send-use-cases.ts`) would need to return per-recipient results, and the OAS output schema would need to be extended beyond the current opaque `"type": "object"` for `sendResult`.

## Dependencies at Risk

**`agentspec_version: "26.1.0"` is pinned in `cinatra/oas.json`:**
- Risk: The OAS pins `agentspec_version: "26.1.0"`. If the platform advances the agentspec version and drops backward compatibility, this agent's OAS may fail marketplace validation without a version bump and OAS regeneration.
- Impact: Agent fails to publish or mount on updated platform versions.
- Migration plan: Monitor Cinatra platform agentspec version changelog; regenerate OAS when breaking changes are introduced.

**`preferredModel: "gpt-5.5"` hardcoded in OAS:**
- Risk: The LLM model preference is hardcoded as `"gpt-5.5"` in `cinatra/oas.json`. If this model is deprecated or renamed by OpenAI, the agent will fail silently or fall back to an unintended model.
- Files: `cinatra/oas.json` (metadata.cinatra.llm and send node cinatra_llm)
- Impact: Unpredictable agent behavior if the named model becomes unavailable.
- Migration plan: Update `preferredModel` in both the top-level metadata and the send node's `cinatra_llm` block when the model name changes.

## Missing Critical Features

**No follow-up email handling:**
- Problem: Per SKILL.md, "this agent handles initial sends only." There is no capability for sending follow-up sequences to non-responders.
- Blocks: Full outreach campaign lifecycle (multi-touch sequences) cannot be completed through this agent.

**No dev-mode redirect verification in agent layer:**
- Problem: The SKILL.md references `sendEmailThroughSystem` in `src/lib/email-system.ts` as the dev-mode redirect chokepoint, but that file does not exist in this extracted repo. The agent's OAS system prompt references the redirect ("All sends route through sendEmailThroughSystem, which applies dev-mode redirect at the bridge layer") but there is no agent-level mechanism to verify the redirect is active.
- Files: `cinatra/oas.json` (send node system prompt), `skills/email-delivery/SKILL.md` (Architecture context)
- Blocks: Safe testing in development environments — if the redirect is inactive, real emails could be sent to live recipients during QA.

## Test Coverage Gaps

**Zero test files in this repo:**
- What's not tested: All agent behavior — OAS correctness beyond the retired-primitive gate, poll logic, error path returns, input schema validation, send result shape.
- Files: Entire repo — no `*.test.*` or `*.spec.*` files detected.
- Risk: Any regression in the OAS schema, prompt instructions, or flow topology goes undetected until marketplace-side validation or a live `agent_run` fails.
- Priority: High — the CI explicitly skips standalone tests for source-mirror repos (`first_party=1`), meaning no test ever runs in this repo's CI pipeline.

**CI skips install, typecheck, and tests for this repo:**
- What's not tested: TypeScript type-correctness of any `src/` code that may be added, dependency resolution, test suite.
- Files: `.github/workflows/ci.yml` (lines 77–80, 100–102, 119–122)
- Risk: If `src/` files are added (as referenced by SKILL.md), they will not be typechecked or tested in standalone CI until the `first_party` detection logic changes.
- Priority: Medium — this is intentional for source-mirror repos, but creates a blind spot if `src/` sources are added without updating the CI contract.

---

*Concerns audit: 2026-06-09*
