// ---------------------------------------------------------------------------
// The send follows the publish decision - zero-dependency, runs under
// `node --test tests/*.test.mjs`. cinatra-ai/cinatra#3745 (the pack's side)
// and cinatra-ai/cinatra#3089.
//
// A run of this agent sends mail on a person's behalf. Sending an email is an
// external write, so the application stops the run in front of the step that
// declares `metadata.cinatra.publishes: true` and shows its publish card; the
// person decides there, an affirmative decision continues to the step and
// every other outcome ends the run. The application admits the step's send
// call only together with that decision, used once. It offers a step only the
// tools its flow declares for it. This suite pins what the FLOW itself owes
// that rule, over cinatra/oas.json:
//
//   1. The send step is the flow's one publishing step, a top-level node, and
//      the flow draws no confirmation of its own: no step waits for a person,
//      no root screen is listed, the send step asks for no approval of its
//      own, and its confirmations list names only the host's publish decision.
//   2. The send step is reached only along the one path start, prepare,
//      filing, read, send; nothing branches; after the send the run ends through
//      the closing statement.
//   3. The send step is a model-free passthrough call of the send start. Its
//      arguments are templates over its own inputs, each fed by a data edge
//      from the start node or the read step, so the send mails with the values
//      the publish card showed; approvedBodies is always the read step's list.
//      The suite reads the tool names every step's call data carries against
//      explicit lists: a name that is not on a list fails, so a tool added to
//      any step turns the suite red until the list names it. Only the send
//      step names the send start, the manifest consumes exactly that
//      primitive, and no step declares a model tool list.
//
// Each test names the change that turns it red.
//
// Known limits
//   - A tool name is read as a snake_case word (it has an underscore) or as
//     a name followed directly by "(". A tool named by one plain word with no
//     parenthesis in the text is not seen. Every tool of this flow's
//     vocabulary has an underscore.
//   - Only the call data of ApiNode steps is read. A tool named in another
//     kind of step is not seen.
//   - The flow is read as its root flow. It has no nested flow today; a
//     FlowNode or Flow component fails the first test.
//   - The copy of the host's declaration reader below is checked against its
//     rule as the PR describes it, not against the host's source.
//   - The stop in front of the publishing step and the single use of the
//     decision are the application's; this suite pins only the declarations
//     the application reads.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
const oas = readJson("cinatra/oas.json");
const pkg = readJson("package.json");

const refOf = (r) => r?.$component_ref;
const steps = oas.$referenced_components;
const nodeIds = (oas.nodes ?? []).map(refOf);
const edges = (oas.control_flow_connections ?? []).map((e) => ({
  from: refOf(e.from_node),
  to: refOf(e.to_node),
  branch: e.from_branch,
}));

const PREPARE = "prepare";
const FILING = "file_recipients";
const READ = "resolve_send";
const SEND = "send";
const SUMMARY = "delivery_summary";
const SEND_TOOL = "email_outreach_send_initial_start";

const into = (id) => edges.filter((e) => e.to === id);
const outOf = (id) => edges.filter((e) => e.from === id);
function reach(without = null) {
  const seen = new Set();
  const todo = [refOf(oas.start_node)];
  while (todo.length) {
    const id = todo.pop();
    if (id === without || seen.has(id)) continue;
    seen.add(id);
    for (const e of outOf(id)) todo.push(e.to);
  }
  return seen;
}

/** Every object in a value that holds the given key, at any depth. */
function holders(value, key, found = []) {
  if (Array.isArray(value)) for (const v of value) holders(v, key, found);
  else if (value && typeof value === "object") {
    if (Object.hasOwn(value, key)) found.push(value);
    for (const v of Object.values(value)) holders(v, key, found);
  }
  return found;
}

test("the flow is one flat graph whose steps are the ones this suite names", () => {
  assert.deepEqual([...nodeIds].sort(), Object.keys(steps).sort(), "a component is not a node of the flow, or a node has no component");
  assert.ok(nodeIds.includes(refOf(oas.start_node)), "the start node is not a node of the flow");
  for (const e of edges) {
    assert.ok(nodeIds.includes(e.from) && nodeIds.includes(e.to), `an edge has an end that is not a node: ${e.from} -> ${e.to}`);
  }
  assert.deepEqual(
    Object.values(steps).filter((c) => c.component_type === "Flow" || c.component_type === "FlowNode"),
    [],
    "the flow nests a flow, which this suite does not read",
  );
  assert.deepEqual([...nodeIds].sort(), ["delivery_summary", "end", FILING, PREPARE, READ, SEND, "start"].sort());
  assert.equal(steps[PREPARE].component_type, "ApiNode");
  assert.equal(steps[FILING].component_type, "ApiNode");
  assert.equal(steps[READ].component_type, "ApiNode");
  assert.match(steps[READ].url, /\/api\/agents\/passthrough$/);
  assert.equal(steps[SEND].component_type, "ApiNode");
  assert.equal(steps[SUMMARY].component_type, "OutputMessageNode");
  assert.match(steps[SEND].url, /\/api\/agents\/passthrough$/);
  assert.match(steps[PREPARE].url, /\/api\/llm-bridge$/);
});

test("the send step is the only step of the flow with the send risk class", () => {
  const sending = Object.entries(steps)
    .filter(([, c]) => c.metadata?.cinatra?.riskClass === "email_send")
    .map(([id]) => id);
  assert.deepEqual(sending, [SEND]);
});

test("the send step is the flow's one publishing step, a top-level node (red: publishes moved, removed or added elsewhere)", () => {
  const publishing = holders(oas, "metadata")
    .filter((c) => c.metadata?.cinatra && Object.hasOwn(c.metadata.cinatra, "publishes"))
    .map((c) => [c.id, c.metadata.cinatra.publishes]);
  assert.deepEqual(publishing.filter(([, v]) => v === true).map(([id]) => id), [SEND]);
  assert.equal(steps[SEND].metadata.cinatra.publishes, true);
  assert.ok(nodeIds.includes(SEND), "the publishing step is not a top-level node");
  assert.equal(steps[SEND].id, SEND, "the host keys the decision by the step's id");
  assert.equal(Object.hasOwn(oas.metadata?.cinatra ?? {}, "publishes"), false, "the flow root declares publishes");
  // Every other step that can reach a connector declares that it makes no external write, or is read-only.
  assert.equal(steps[FILING].metadata.cinatra.publishes, false);
  assert.equal(steps[READ].metadata.cinatra.publishes, false);
  assert.equal(steps[READ].metadata.cinatra.riskClass, "read_only");
  assert.equal(steps[PREPARE].metadata.cinatra.riskClass, "read_only");
});

test("the flow draws no confirmation of its own (red: a step that waits for a person, a root screen, an approval on the send, or a gate renderer)", () => {
  assert.deepEqual(
    Object.entries(steps).filter(([, c]) => c.component_type === "InputMessageNode").map(([id]) => id),
    [],
    "a step of the flow waits for a person",
  );
  assert.equal(Object.hasOwn(oas.metadata?.cinatra ?? {}, "hitlScreens"), false, "the flow lists a screen of its own");
  assert.equal(steps[SEND].metadata.cinatra.requiresApproval, false);
  assert.deepEqual(holders(oas, "gateRenderer"), [], "a component names a gate renderer");
  assert.deepEqual(holders(oas, "x-renderer"), [], "a schema selects a renderer of its own");
  assert.deepEqual(holders(oas, "inputMessageSchema"), [], "a component carries a confirmation form");
  assert.deepEqual(holders(oas, "requiresApproval").filter((c) => c.requiresApproval !== false), []);
});

test("the send step's confirmations list names the publish decision for the send start and nothing else (red: a gate renderer, any other key, another tool)", () => {
  // The host does not read this list (it holds the step by its publishes flag
  // and its decision row); the list says, for this suite, which decision the
  // send start waits for. The former `arguments` key pointed into the answer of
  // the flow's own confirmation step, which no longer exists; it never bound
  // the arguments of a publishing step. The next test states what binds them.
  assert.deepEqual(steps[SEND].metadata.cinatra.confirmations, [{ tool: SEND_TOOL, decision: "publish" }]);
  assert.equal(steps[SEND].data.tool, SEND_TOOL, "the send step does not call the tool its decision covers");
  const elsewhere = holders(oas, "confirmations").filter((c) => c !== steps[SEND].metadata.cinatra);
  assert.deepEqual(elsewhere, [], "another component declares confirmations");
});

// What binds the send start's arguments. The host holds a publishing step
// until its decision is released, and the passthrough road serves the send
// start only to a listed publishing step whose decision is released (cinatra
// src/app/api/agents/passthrough/route.ts with publishingStepCallReleased,
// cinatra#3089). The send step is that road's call: its `data` is the request
// body, `tool` names the send start, and each argument in `input` is a template
// over one of the step's own inputs, which a data edge feeds from the start
// node or the read step. No model writes an argument: the arguments the send
// start mails with are the values the publish card showed.
const SEND_ARGUMENTS = {
  approvedBodies: { input: "emailBodies", template: "{{ emailBodies | tojson }}", from: "resolve_send.emailBodies" },
  approvedDraftBundleRef: { input: "approvedDraftBundleRef", template: "{{ approvedDraftBundleRef }}", from: "start.approvedDraftBundleRef" },
  campaignId: { input: "campaignId", template: "{{ campaignId }}", from: "start.campaignId" },
  confirmedRecipientsRef: { input: "confirmedRecipientsRef", template: "{{ confirmedRecipientsRef }}", from: "start.confirmedRecipientsRef" },
  senderEmail: { input: "senderEmail", template: "{{ senderEmail }}", from: "start.senderEmail" },
};
const LEADING_COMMENT = /^\{#[\s\S]*?#\}/;
const dataEdgesInto = (step, input) =>
  (oas.data_flow_connections ?? []).filter((e) => refOf(e.destination_node) === step && e.destination_input === input);

test("the send start's arguments are the flow's own values: the send step is a model-free passthrough call, and each argument is one input fed from the start node or the read step (red: a model step, another tool, an argument added, removed, renamed or written another way)", () => {
  const send = steps[SEND];
  assert.equal(send.component_type, "ApiNode");
  assert.equal(send.url, "{{CINATRA_BASE_URL}}/api/agents/passthrough", "the send is not a passthrough call");
  assert.equal(send.http_method, "POST");
  assert.deepEqual(Object.keys(send.data).sort(), ["agent_run_id", "input", "tool"], "the send's call data carries a key the passthrough road does not read, or a model text");
  assert.equal(send.data.tool, SEND_TOOL);
  assert.equal(send.data.agent_run_id, "{{ agent_run_id }}");
  assert.equal(dataEdgesInto(SEND, "agent_run_id").map((e) => `${refOf(e.source_node)}.${e.source_output}`).join(), "start.agent_run_id");
  assert.deepEqual(Object.keys(send.data.input).sort(), Object.keys(SEND_ARGUMENTS).sort());
  for (const [argument, { input, template, from }] of Object.entries(SEND_ARGUMENTS)) {
    const value = send.data.input[argument];
    assert.equal(typeof value, "string", `${argument} is not one template`);
    assert.equal(value.replace(LEADING_COMMENT, ""), template, `${argument} is not rendered from the input ${input} alone`);
    assert.ok((send.inputs ?? []).some((entry) => entry.title === input), `the send step declares no input ${input}`);
    const feeds = dataEdgesInto(SEND, input).map((e) => `${refOf(e.source_node)}.${e.source_output}`);
    assert.deepEqual(feeds, [from], `the send step's ${input} is not fed by ${from} alone`);
  }
  for (const key of ["arguments", "boundArguments", "expectedArgs", "argsDigest", "toolArgs"]) {
    assert.deepEqual(holders(oas, key), [], `a component declares ${key}, which the host does not read`);
  }
});

test("the send start always takes the approved bodies in the strict form: the list the read step resolved, never the references alone (red: approvedBodies left out, made conditional or given a default)", () => {
  const value = steps[SEND].data.input.approvedBodies;
  assert.ok(typeof value === "string" && value.endsWith("{{ emailBodies | tojson }}"));
  assert.doesNotMatch(value.replace(LEADING_COMMENT, ""), /\{%/, "approvedBodies is passed only under a condition");
  const input = (steps[SEND].inputs ?? []).find((entry) => entry.title === "emailBodies");
  assert.equal(Object.hasOwn(input, "default"), false, "the send step's bodies have a default, so the step can start without the read step's list");
  assert.equal(input.type, "array");
  assert.equal(input.json_schema.maxItems, 50);
});

test("the send step's outputs are the members of the send start's answer, each with a default (red: an output the answer does not carry, or one without a default)", () => {
  // The send start answers { operationId, kind, status, startedAt, completedAt, sentCount, errorMessage } and, in its
  // strict form, alreadySentCount and inDoubtCount; the road hands each declared output from the member of the same
  // name, and a member the answer lacks takes the output's default.
  const declared = (steps[SEND].outputs ?? []).map(({ title, type, default: fallback }) => ({ title, type, default: fallback }));
  assert.deepEqual(declared, [
    { title: "status", type: "string", default: "" },
    { title: "sentCount", type: "integer", default: 0 },
    { title: "operationId", type: "string", default: "" },
    { title: "errorMessage", type: "string", default: "" },
    { title: "alreadySentCount", type: "integer", default: 0 },
    { title: "inDoubtCount", type: "integer", default: 0 },
  ]);
});

test("the send step is reached only along start, prepare, filing, read (red: an edge into the send, the read or the filing from any other step)", () => {
  assert.deepEqual(into(SEND).map((e) => e.from), [READ], "the send has another way in");
  assert.deepEqual(into(READ).map((e) => e.from), [FILING], "the read before the send has another way in");
  assert.deepEqual(into(FILING).map((e) => e.from), [PREPARE], "the filing before the send has another way in");
  assert.deepEqual(into(PREPARE).map((e) => e.from), ["start"], "the prepare step has another way in");
  assert.ok(reach().has(SEND), "the send is not reachable at all");
  assert.equal(reach(FILING).has(SEND), false, "the send is reachable around the filing step");
  assert.equal(reach(READ).has(SEND), false, "the send is reachable around the read step");
});

test("nothing branches and every step has one way out (red: a second edge out of a step, a named branch, or a branching step)", () => {
  for (const id of nodeIds.filter((n) => n !== "end")) {
    const out = outOf(id);
    assert.equal(out.length, 1, `${id} has ${out.length} ways out`);
    assert.equal(out[0].branch, undefined, `${id}'s edge is a named branch`);
  }
  const branching = Object.entries(steps).filter(([, c]) => c.component_type === "BranchingNode");
  assert.deepEqual(branching.map(([id]) => id), [], "a step of the flow branches");
});

test("after the send the run ends through the closing statement (red: an edge from the send to anything else)", () => {
  assert.deepEqual(outOf(SEND).map((e) => e.to), [SUMMARY]);
  assert.deepEqual(outOf(SUMMARY).map((e) => e.to), ["end"]);
});

// -- the tool names a step's call data carries ------------------------------

const TEMPLATE = /\{\{[\s\S]*?\}\}|\{#[\s\S]*?#\}/g;
const SNAKE_NAME = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;
const CALLED_NAME = /\b([A-Za-z_][A-Za-z0-9_]*)\(/g;

function stringsOf(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) stringsOf(v, out);
  return out;
}

/** Every tool-shaped name in a step's call data: its `tool`, every snake_case word and every name followed by "(" in its text. Template slots and comments are left out. */
function namesIn(step) {
  const names = new Set();
  for (const raw of stringsOf(step.data ?? {})) {
    const text = raw.replace(TEMPLATE, " ");
    for (const m of text.matchAll(SNAKE_NAME)) names.add(m[0]);
    for (const m of text.matchAll(CALLED_NAME)) names.add(m[1]);
  }
  if (typeof step.data?.tool === "string") names.add(step.data.tool);
  return [...names].sort();
}

// The send step calls the send start and names no other tool. The passthrough
// road serves the send start only to a listed publishing step whose decision is
// released, and the send step is the flow's one publishing step.
const SEND_STEP_TOOLS = [SEND_TOOL];

// What every other step of the flow names today. A tool-shaped name added to
// one of them, or a step added or removed, fails the suite until this list is
// changed in the same commit. None of these names is a send tool; a send tool
// named by any step but the send step is therefore a name that is not on this
// list. The prepare step's second name is the read-only preview of the send
// (cinatra-ai/cinatra#3745): it sends nothing and returns the counts and the
// content digest of the pending send.
const OTHER_STEP_NAMES = {
  [PREPARE]: ["email_outreach_send_initial_preview", "objects_get"],
  [FILING]: ["extension_tool", "recipient_records"],
  [READ]: ["extension_tool", "send_contents"],
};

test("the send step names the send start and no other tool (red: any other snake_case name or name( call in the send step's call data)", () => {
  assert.deepEqual(namesIn(steps[SEND]), SEND_STEP_TOOLS);
});

test("the send start is the one primitive the manifest consumes (red: a primitive consumed and not called, or called and not consumed)", () => {
  const consumed = (pkg.cinatra.consumes ?? []).map((c) => c.primitive).sort();
  assert.deepEqual(consumed, SEND_STEP_TOOLS);
});

test("every other step names the tools this suite lists for it and no other (red: a new tool-shaped name in a step's call data, a send tool on a step before the send, or a step added or removed)", () => {
  const others = Object.entries(steps).filter(([id, c]) => c.component_type === "ApiNode" && id !== SEND);
  assert.deepEqual(others.map(([id]) => id).sort(), Object.keys(OTHER_STEP_NAMES).sort());
  for (const [id, step] of others) assert.deepEqual(namesIn(step), OTHER_STEP_NAMES[id], id);
  const sendTools = ["email_outreach_send_initial_start", "email_outreach_send_initial_status", "email_outreach_send_initial_cancel"];
  for (const [id, step] of others) {
    for (const name of sendTools) assert.ok(!namesIn(step).includes(name), `${id} names ${name}`);
  }
});

// -- the model steps' tool offer --------------------------------------------

/** The host's reading of a model-bridge step's declaration, `metadata.cinatra.tools`. */
function readDeclaration(node) {
  const cinatra = node?.metadata?.cinatra;
  if (!cinatra || typeof cinatra !== "object" || !Object.hasOwn(cinatra, "tools")) return { kind: "undeclared" };
  const list = cinatra.tools;
  if (!Array.isArray(list)) return { kind: "invalid" };
  const seen = new Set();
  for (const name of list) {
    if (typeof name !== "string" || name.trim() === "" || /\s/.test(name) || name !== name.toLowerCase() || seen.has(name)) {
      return { kind: "invalid" };
    }
    seen.add(name);
  }
  return { kind: "declared", tools: [...list] };
}

const withTools = (tools) => ({ metadata: { cinatra: { tools } } });

test("the copy of the host's declaration reader reads the cases its rule names", () => {
  assert.deepEqual(readDeclaration({}), { kind: "undeclared" });
  assert.deepEqual(readDeclaration({ metadata: { cinatra: {} } }), { kind: "undeclared" });
  assert.deepEqual(readDeclaration(withTools([])), { kind: "declared", tools: [] });
  assert.deepEqual(readDeclaration(withTools(["objects_get", "b_c"])), { kind: "declared", tools: ["objects_get", "b_c"] });
  for (const bad of ["objects_get", null, [1], [""], ["  "], ["a b"], ["Objects_get"], ["a_b", "a_b"]]) {
    assert.deepEqual(readDeclaration(withTools(bad)), { kind: "invalid" }, JSON.stringify(bad));
  }
});

// The host reads `metadata.cinatra.tools` on a model-bridge step only and
// refuses the key on any other step. The flow's one model
// step, the prepare step, declares nothing, and the send step is no model step,
// so no step of the flow carries the key and no model step is offered the send.
test("no step declares a tool list, and the one model step is the read-only prepare step (red: a `tools` key on any step, or a second model step)", () => {
  const withKey = Object.entries(steps)
    .filter(([, c]) => Object.hasOwn(c.metadata?.cinatra ?? {}, "tools"))
    .map(([id]) => id);
  assert.deepEqual(withKey, []);
  assert.deepEqual(readDeclaration(steps[PREPARE]), { kind: "undeclared" });
  const modelSteps = Object.entries(steps)
    .filter(([, c]) => c.component_type === "ApiNode" && String(c.url).endsWith("/api/llm-bridge"))
    .map(([id]) => id);
  assert.deepEqual(modelSteps, [PREPARE]);
  assert.equal(steps[PREPARE].metadata.cinatra.riskClass, "read_only");
  assert.equal(Object.values(steps).filter((c) => c.id === SEND).length, 1, "two steps share the send step's id");
});
