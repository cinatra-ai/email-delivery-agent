// Lifecycle D W8 — the email delivery agent's plain ending (cinatra#3096 item 19).
//
// (19) A delivery run closes with one plain sentence after the send: how many
// campaign emails went out, or that the send stopped, with the reason when the
// send reports one, or that no send ran — never with the raw answer.
// The send start's answer (its status, the number sent and the reason of a
// failure) is still handed on at the end for an agent that started the run.
//
// Three more arms check this flow against the rules the runtime applies when
// it mounts a flow, the same rules cinatra-ai/email-outreach-agent checks for
// its own flow: (A) each input a step needs gets a value on each path to that
// step, (B) a closing statement declares no input its sentence does not read,
// and (C) each declared default is of the type its entry declares.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
const oas = read("cinatra/oas.json");
const pkg = read("package.json");

const refs = oas.$referenced_components;
const nodesOfType = (type) => Object.values(refs).filter((n) => n.component_type === type);
const controlEdges = (oas.control_flow_connections ?? []).map((e) => ({
  from: e.from_node.$component_ref,
  to: e.to_node.$component_ref,
  branch: e.from_branch,
}));
const hasEdge = (from, to, branch) =>
  controlEdges.some((e) => e.from === from && e.to === to && (branch === undefined || e.branch === branch));
const dataEdges = (oas.data_flow_connections ?? []).map((e) => [
  e.source_node.$component_ref + "." + e.source_output,
  e.destination_node.$component_ref + "." + e.destination_input,
]);
const countDataEdges = (from, to) => dataEdges.filter(([f, t]) => f === from && t === to).length;
const outsideComment = (message) => String(message ?? "").replace(/\{#[\s\S]*?#\}/g, "");

const MESSAGE = "{# pyagentspec-input-hint (do not remove): {{ status }} {{ sentCount }} {{ errorMessage }} #}{% if status == 'completed' %}{% if sentCount == 1 %}1 campaign email was sent.{% elif sentCount %}{{ sentCount }} campaign emails were sent.{% else %}The send finished, but no campaign email went out.{% endif %}{% elif status == 'failed' %}{% if errorMessage %}The campaign emails could not be sent: {{ errorMessage }}{% else %}The campaign emails could not be sent, and the send gave no reason.{% endif %}{% else %}No campaign email was sent in this run.{% endif %}";

test("(19) the run ends in plain language after the send, never in the envelope", () => {
  const summary = refs.delivery_summary;
  assert.ok(summary, "the run has no closing statement");
  assert.equal(summary.component_type, "OutputMessageNode");
  assert.ok(oas.nodes.some((n) => n.$component_ref === "delivery_summary"), "the closing statement is not a step of the flow");
  assert.ok(hasEdge("send", "delivery_summary"), "the send does not lead to the closing statement");
  assert.ok(hasEdge("delivery_summary", "end"), "the closing statement does not lead to the end");
  assert.ok(!hasEdge("send", "end"), "the run still jumps from the send straight to its end");
  // The send start's answer is still handed on at the end, for an agent that started the run.
  assert.deepEqual(refs.end.outputs.map((o) => o.title), ["sendStatus", "sentCount", "sendErrorMessage"]);
  assert.equal(countDataEdges("send.status", "end.sendStatus"), 1);
  assert.equal(countDataEdges("send.sentCount", "end.sentCount"), 1);
  assert.equal(countDataEdges("send.errorMessage", "end.sendErrorMessage"), 1);
});

test("(19) an empty, failed or finished send ends in the sentence as written, from the send start's answer", () => {
  const summary = refs.delivery_summary;
  assert.ok(summary, "the run has no closing statement");
  assert.equal(summary.message, MESSAGE);
  assert.equal(summary.metadata?.cinatra?.purpose, "plain-language-delivery-ending");
  assert.deepEqual(summary.inputs, [
    { title: "status", type: "string", default: "" },
    { title: "sentCount", type: "integer", default: 0 },
    { title: "errorMessage", type: "string", default: "" },
  ]);
  for (const name of ["status", "sentCount", "errorMessage"]) {
    assert.equal(countDataEdges(`send.${name}`, `delivery_summary.${name}`), 1, `the closing statement's ${name} is not the send's`);
  }
});

// A failed send start answers its reason as text; the sentence says that the
// emails could not be sent and why, and never that none went out, because a
// send that stops part way answers failed.
test("(19) a failed send ends with its reason and never claims that no email went out", () => {
  const failed = MESSAGE.slice(MESSAGE.indexOf("{% elif status == 'failed' %}"), MESSAGE.lastIndexOf("{% else %}"));
  assert.ok(failed.includes("{{ errorMessage }}"), "a failed send does not say what stopped it");
  assert.doesNotMatch(failed, /No campaign email was sent/, "a failed send claims that none went out");
});

test("(19) the closing statement follows the send, the send follows the read step alone, and the read step follows the filing step alone", () => {
  const into = (id) => controlEdges.filter((e) => e.to === id).map((e) => e.from).sort();
  assert.deepEqual(into("delivery_summary"), ["send"]);
  assert.deepEqual(into("send"), ["resolve_send"]);
  assert.deepEqual(into("resolve_send"), ["file_recipients"]);
  assert.deepEqual(into("file_recipients"), ["prepare"]);
  assert.deepEqual(into("end"), ["delivery_summary"]);
});

// ---------------------------------------------------------------------------
// (A) every required step input has a source on every path that reaches it
// ---------------------------------------------------------------------------

/** The inputs a node CONSUMES: an EndNode names them under `outputs`, every
 *  other node declares `inputs`. */
function consumedInputs(node) {
  if (node.component_type === "EndNode") return node.outputs ?? [];
  return node.inputs ?? [];
}

/** Walk the flow the way the runtime loader does, returning each input it
 *  would demand from the StartStep. */
function unsourcedInputs() {
  const steps = new Map();
  for (const ref of oas.nodes ?? []) steps.set(ref.$component_ref, refs[ref.$component_ref]);
  const beginId = oas.start_node.$component_ref;
  const startTitles = new Set((steps.get(beginId)?.inputs ?? []).map((i) => i.title));
  const flowDataEdges = (oas.data_flow_connections ?? []).map((e) => ({
    from: e.source_node.$component_ref,
    key: `${e.destination_node.$component_ref}.${e.destination_input}`,
  }));
  const successors = (id) => controlEdges.filter((e) => e.from === id).map((e) => e.to);

  const violations = [];
  const visited = new Map();
  const queue = [[beginId, new Set()]];
  while (queue.length > 0) {
    const [id, incoming] = queue.pop();
    let produced = incoming;
    if (visited.has(id)) {
      const seen = visited.get(id);
      if ([...seen].every((k) => produced.has(k))) continue;
      produced = new Set([...produced].filter((k) => seen.has(k)));
    }
    visited.set(id, produced);

    const node = steps.get(id);
    if (!node) continue;
    if (id !== beginId) {
      for (const descriptor of consumedInputs(node)) {
        const key = `${id}.${descriptor.title}`;
        if (produced.has(key)) continue;
        if (Object.hasOwn(descriptor, "default")) continue;
        if (startTitles.has(descriptor.title)) continue;
        violations.push(key);
      }
    }

    const next = new Set(produced);
    for (const edge of flowDataEdges) if (edge.from === id) next.add(edge.key);
    for (const child of successors(id)) queue.push([child, new Set(next)]);
  }
  return violations;
}

test("every required step input has a source on every path that reaches it", () => {
  const found = unsourcedInputs();
  assert.deepEqual(
    found,
    [],
    "the runtime refuses to mount a flow whose step requires an input the StartStep does not carry: " + found.join(", "),
  );
});

// ---------------------------------------------------------------------------
// (B) an OutputMessageNode declares only inputs its template reads
// ---------------------------------------------------------------------------

test("an output message declares only inputs its template reads", () => {
  const offenders = [];
  for (const node of nodesOfType("OutputMessageNode")) {
    const rendered = outsideComment(node.message);
    for (const { title } of node.inputs ?? []) {
      if (!new RegExp(`\\b${title}\\b`).test(rendered)) offenders.push(`${node.id}.${title}`);
    }
  }
  assert.deepEqual(offenders, [], "the runtime rejects an input the template never reads: " + offenders.join(", "));
});

// ---------------------------------------------------------------------------
// (C) every declared default fits its declared type
// ---------------------------------------------------------------------------

/** Whether a default fits a declared JSON schema type, by the rule the
 *  runtime's spec loader applies at mount: null only where the type carries
 *  "null", an object only a plain object, an array only a list, a string only a
 *  string, and the numeric types (number, integer, boolean) a number or a
 *  boolean. A type written as a list is read as any of its members. */
function defaultFitsType(value, type) {
  if (Array.isArray(type)) return type.some((member) => defaultFitsType(value, member));
  if (value === null) return type === "null";
  switch (type) {
    case "object":
      return typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
    case "boolean":
      return typeof value === "number" || typeof value === "boolean";
    default:
      return false;
  }
}

test("(19) every declared default fits its declared type", () => {
  assert.ok(nodesOfType("OutputMessageNode").length > 0, "the flow has no closing statement to check");
  const misfits = [];
  const check = (owner, descriptors) => {
    for (const d of descriptors ?? []) {
      if (!Object.hasOwn(d, "default") || d.type === undefined) continue;
      if (!defaultFitsType(d.default, d.type)) misfits.push(`${owner}.${d.title}`);
    }
  };
  check(oas.id, oas.inputs);
  check(oas.id, oas.outputs);
  for (const [id, component] of Object.entries(refs)) {
    check(id, component.outputs);
    // The runtime's loader drops a gate's declared inputs before the load.
    if (component.component_type !== "InputMessageNode") check(id, component.inputs);
  }
  assert.deepEqual(
    misfits,
    [],
    "the runtime refuses a default its declared type does not allow: " + misfits.join(", "),
  );

  const message = String(refs.delivery_summary?.message ?? "");
  assert.ok(message.indexOf("{% if status == 'completed' %}") >= 0, "the closing sentence does not test the send's status first");
  assert.ok(message.endsWith("{% else %}No campaign email was sent in this run.{% endif %}"), "a run with no answer from the send does not end in its own sentence");
});
