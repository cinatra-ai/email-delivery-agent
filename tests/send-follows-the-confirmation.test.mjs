// ---------------------------------------------------------------------------
// The send follows the confirmation — zero-dependency, runs under
// `node --test tests/*.test.mjs`. cinatra-ai/cinatra#3745 (acceptance 5, the
// pack's side).
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
//      model-bridge step's declaration from `metadata.cinatra.tools`. This
//      flow declares none for any step today, so the host offers each step
//      every tool it serves; the suite pins that reading, and pins that the
//      tools the send step's own text calls are the primitives the manifest
//      consumes plus the read tool, and that the step before the confirmation
//      calls no send tool.
//
// These pins hold at the base: they guard it. Each test names the change that
// turns it red.
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

test("the steps this suite names are the ones the flow has", () => {
  assert.equal(steps[PREPARE]?.component_type, "ApiNode");
  assert.equal(steps[GATE]?.component_type, "InputMessageNode");
  assert.equal(steps[FILING]?.component_type, "ApiNode");
  assert.equal(steps[SEND]?.component_type, "ApiNode");
  assert.match(steps[SEND].url, /\/api\/llm-bridge$/);
  assert.match(steps[PREPARE].url, /\/api\/llm-bridge$/);
});

test("the send step is the only step of the flow with the send risk class", () => {
  const sending = Object.entries(steps)
    .filter(([, c]) => c?.metadata?.cinatra?.riskClass === "email_send")
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
  const branching = Object.entries(steps).filter(([, c]) => c?.component_type === "BranchingNode");
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

const callsOf = (node) => {
  const text = `${node.data.system}\n${node.data.user}`;
  return [...new Set(text.match(/\b(?:objects|email|gmail|social|linkedin|artifact|extension)_[a-z0-9_]+\b/g) ?? [])].sort();
};

// What this flow declares for its model steps. Nothing is declared today, so
// the host offers each step every tool it serves. Declaring a list for the
// send step is a change of this constant in the same change (red: a `tools`
// key on the send step).
const SEND_STEP_DECLARATION = { kind: "undeclared" };
// The tool names the send step's own text (system and user message) calls.
const SEND_STEP_CALLS = ["email_outreach_send_initial_start", "email_outreach_send_initial_status", "objects_get"];

test("the send step's declaration reads as this suite pins it", () => {
  assert.deepEqual(readDeclaration(steps[SEND]), SEND_STEP_DECLARATION);
  assert.deepEqual(readDeclaration(steps[PREPARE]), { kind: "undeclared" });
});

test("the send step's text calls the tools this suite names and no other (red: the text starts to call another tool)", () => {
  assert.deepEqual(callsOf(steps[SEND]), [...SEND_STEP_CALLS].sort());
});

test("the send primitives the send step calls are the ones the manifest consumes (red: a consumed primitive the step does not call, or a send primitive the manifest does not name)", () => {
  const consumed = (pkg.cinatra.consumes ?? []).map((c) => c.primitive).sort();
  const calledSends = callsOf(steps[SEND]).filter((n) => n.startsWith("email_outreach_send_"));
  assert.deepEqual(calledSends, consumed);
});

test("the step before the confirmation calls no send tool (red: a send tool named in the pre-send step)", () => {
  assert.deepEqual(callsOf(steps[PREPARE]), ["objects_get"]);
});

test("no step but the confirmed send names a send tool (red: a passthrough step that names one)", () => {
  const SEND_TOOL = /\b(?:email_send|gmail_email_send|email_outreach_send_[a-z_]+|social_media_publish|linkedin_post_publish)\b/g;
  const named = [];
  for (const [id, comp] of Object.entries(steps)) {
    if (id === SEND || comp?.component_type !== "ApiNode") continue;
    for (const hit of JSON.stringify(comp.data ?? {}).match(SEND_TOOL) ?? []) named.push(`${id}: ${hit}`);
  }
  assert.deepEqual(named, []);
});
