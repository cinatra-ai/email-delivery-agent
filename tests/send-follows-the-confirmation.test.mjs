// ---------------------------------------------------------------------------
// The send follows the confirmation - zero-dependency, runs under
// `node --test tests/*.test.mjs`. cinatra-ai/cinatra#3745 (the pack's side).
//
// A run of this agent sends mail on a person's behalf. The platform holds a
// send until the person has decided, and it offers a step only the tools its
// flow declares for it. This suite pins the two things the FLOW itself owes
// that rule, over cinatra/oas.json:
//
//   1. The step that sends is reached only through the confirmation's one
//      affirmative edge. The confirmation has one edge out and no branch, and
//      nothing routes on its answer, so every other outcome has no edge to
//      follow and the run ends at the confirmation.
//   2. The send step's tool offer is the flow's declaration. The host reads a
//      model-bridge step's declaration from `metadata.cinatra.tools`. The
//      send step declares the tools its recipe calls and no other, so the
//      host offers it exactly those; the prepare step declares none. The
//      suite pins that reading, and it reads the tool names every step's call
//      data carries against explicit lists: a name that is not on a list
//      fails, so a tool added to any step turns the suite red until the list
//      names it. The send primitives on the send step's list are exactly the
//      primitives the manifest consumes, and the declared list is exactly the
//      tools the send step's text calls.
//
// The pins hold at the base: they guard it. Each test names the change that
// turns it red.
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
const GATE = "approval_gate";
const FILING = "file_recipients";
const SEND = "send";
const SUMMARY = "delivery_summary";

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
  assert.equal(steps[PREPARE].component_type, "ApiNode");
  assert.equal(steps[GATE].component_type, "InputMessageNode");
  assert.equal(steps[FILING].component_type, "ApiNode");
  assert.equal(steps[SEND].component_type, "ApiNode");
  assert.equal(steps[SUMMARY].component_type, "OutputMessageNode");
  assert.match(steps[SEND].url, /\/api\/llm-bridge$/);
  assert.match(steps[PREPARE].url, /\/api\/llm-bridge$/);
});

test("the send step is the only step of the flow with the send risk class", () => {
  const sending = Object.entries(steps)
    .filter(([, c]) => c.metadata?.cinatra?.riskClass === "email_send")
    .map(([id]) => id);
  assert.deepEqual(sending, [SEND]);
});

test("the send step is reached only through the confirmation (red: an edge into the send or the filing from any other step)", () => {
  assert.deepEqual(into(SEND).map((e) => e.from), [FILING], "the send has another way in");
  assert.deepEqual(into(FILING).map((e) => e.from), [GATE], "the filing before the send has another way in");
  assert.deepEqual(into(GATE).map((e) => e.from), [PREPARE], "the confirmation has another way in");
  assert.ok(reach().has(SEND), "the send is not reachable at all");
  assert.equal(reach(GATE).has(SEND), false, "the send is reachable around the confirmation");
  assert.equal(reach(GATE).has(FILING), false, "the filing is reachable around the confirmation");
});

test("the confirmation has one edge out, the affirmative one, and nothing routes on its answer (red: a second edge out of the confirmation, or a branching step)", () => {
  const out = outOf(GATE);
  assert.equal(out.length, 1, "the confirmation has more than one way out");
  assert.equal(out[0].to, FILING);
  assert.equal(out[0].branch, undefined, "the confirmation's edge is a named branch");
  const branching = Object.entries(steps).filter(([, c]) => c.component_type === "BranchingNode");
  assert.deepEqual(branching.map(([id]) => id), [], "a step of the flow branches");
  // The one place the confirmation's answer goes is the end node.
  const readers = (oas.data_flow_connections ?? [])
    .filter((e) => refOf(e.source_node) === GATE && e.source_output === "userResponse")
    .map((e) => refOf(e.destination_node));
  assert.deepEqual(readers, ["end"], "a step reads the confirmation's answer");
});

test("the confirmation offers the three decisions and requires one", () => {
  const gate = steps[GATE];
  const schema = gate.metadata.cinatra.inputMessageSchema;
  assert.deepEqual(schema.properties.decision.enum, ["approve", "revise", "reject"]);
  assert.ok(schema.required.includes("decision"));
  assert.equal(gate.metadata.cinatra.requiresApproval, true);
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

// The tools the send step's text may call: the read tool and the send
// primitives. The send primitives are exactly the manifest's consumed
// primitives (the next test reads them). A tool-shaped name outside this list
// and the words list fails the suite until it is listed here.
const SEND_STEP_TOOLS = ["email_outreach_send_initial_start", "email_outreach_send_initial_status", "objects_get"];
// Snake_case words of the send step's text that are not tools.
const SEND_STEP_WORDS = ["agent_run", "agent_run_id", "max_steps"];

// What every other step of the flow names today. A tool-shaped name added to
// one of them, or a step added or removed, fails the suite until this list is
// changed in the same commit. None of these names is a send tool; a send tool
// named by any step but the send step is therefore a name that is not on this
// list. The prepare step's second name is the read-only preview of the send
// (cinatra-ai/cinatra#3745): it sends nothing and returns the counts and the
// content digest that the confirmation carries.
const OTHER_STEP_NAMES = {
  [PREPARE]: ["email_outreach_send_initial_preview", "objects_get"],
  [FILING]: ["extension_tool", "recipient_records"],
};

test("the send step's text names the tools and words this suite lists and no other (red: any new snake_case name or name( call in the send step's call data)", () => {
  assert.deepEqual(namesIn(steps[SEND]), [...SEND_STEP_TOOLS, ...SEND_STEP_WORDS].sort());
});

test("the send primitives on the send step's list are exactly the primitives the manifest consumes (red: a primitive consumed and not listed, or listed and not consumed)", () => {
  const consumed = (pkg.cinatra.consumes ?? []).map((c) => c.primitive).sort();
  assert.deepEqual(SEND_STEP_TOOLS.filter((n) => n !== "objects_get"), consumed);
});

test("every other step names the tools this suite lists for it and no other (red: a new tool-shaped name in a step's call data, a send tool before the confirmation, or a step added or removed)", () => {
  const others = Object.entries(steps).filter(([id, c]) => c.component_type === "ApiNode" && id !== SEND);
  assert.deepEqual(others.map(([id]) => id).sort(), Object.keys(OTHER_STEP_NAMES).sort());
  for (const [id, step] of others) assert.deepEqual(namesIn(step), OTHER_STEP_NAMES[id], id);
});

// -- the send step's tool offer ---------------------------------------------

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

// What this flow declares for its model steps. The send step declares the
// tools its recipe calls, so the host offers it those and no other; the
// prepare step declares nothing. This is a change detector: a change of the
// send step's list changes this constant in the same commit.
const SEND_STEP_DECLARATION = { kind: "declared", tools: SEND_STEP_TOOLS };

test("the send and prepare steps' declarations read as this suite pins them (a change detector: red on a changed list on the send step, or a `tools` key on the prepare step)", () => {
  assert.deepEqual(readDeclaration(steps[SEND]), SEND_STEP_DECLARATION);
  assert.deepEqual(readDeclaration(steps[PREPARE]), { kind: "undeclared" });
});

test("the send step's declared list is exactly the tools its text calls (red: no list, a tool the text calls and the list lacks, or a tool the list holds and the text does not call)", () => {
  const reading = readDeclaration(steps[SEND]);
  assert.equal(reading.kind, "declared", "the send step declares no list");
  assert.deepEqual([...reading.tools].sort(), SEND_STEP_TOOLS);
  const called = namesIn(steps[SEND]).filter((name) => !SEND_STEP_WORDS.includes(name));
  assert.deepEqual([...reading.tools].sort(), called);
});

test("the list is written in the form the host reads and sits on a model-bridge step only (red: a `tools` key on a step that is not a model step)", () => {
  const withKey = Object.entries(steps)
    .filter(([, c]) => Object.hasOwn(c.metadata?.cinatra ?? {}, "tools"))
    .map(([id]) => id);
  assert.deepEqual(withKey, [SEND]);
  assert.match(steps[SEND].url, /\/api\/llm-bridge$/);
  assert.equal(steps[SEND].id, SEND, "the host reads a declaration by the step's id");
  assert.deepEqual(
    Object.values(steps).filter((c) => c.id === SEND).length,
    1,
    "two steps share the send step's id",
  );
});
