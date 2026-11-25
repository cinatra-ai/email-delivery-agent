// Parity of this flow with the way the Email Outreach Agent runs it.
//
// The outreach pack (@cinatra-ai/email-outreach-agent) cannot embed this flow
// whole. The application stops a run in front of a publishing step and takes a
// person's decision there, and it does so only for a step that sits at the top
// level of the root flow; a send nested in a subflow can never be released. The
// application serves this package's tools (recipient_records, send_contents)
// only to steps that sit directly in a definition that a root flow node of this
// package references, as copies of this flow's own steps. So the outreach cuts
// this flow in two:
//
//   1. an embedded copy that PREPARES the send: start, the filing step, the
//      read step, end. The two tool steps are this flow's, the id aside. The
//      end hands on what the read step resolved: the recipients, the emails and
//      the call to action. The copy has no publishing step, no step that waits
//      for a person and no model step.
//   2. this flow's send step, carried unchanged to the top level of the
//      outreach flow, where it is the publishing step: its card rows, its
//      confirmation and its renderer stay as they are. It takes the three
//      resolved values from the copy and the campaign, the sender, the two
//      references and the run from the outreach's own inputs.
//
// The fixtures are those two values taken whole:
//   tests/fixtures/email-outreach-delivery-subflow.json   the prepare copy, the
//     value of "email-delivery-subflow" with the generator's prefix "sender-";
//   tests/fixtures/email-outreach-delivery-send.json      the send step, the
//     value of "send", unprefixed.
// The rule is EQUALITY: the copy is this flow with the named differences in
// DIFFERENCES below, in that order, and then the prefix, and nothing else; the
// carried send is this flow's send exactly. Each named difference must still
// apply to this flow, so a difference that no longer has a reason fails here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (...parts) => JSON.parse(readFileSync(join(root, ...parts), "utf8"));
const oas = readJson("cinatra", "oas.json");
const copy = readJson("tests", "fixtures", "email-outreach-delivery-subflow.json");
const carried = readJson("tests", "fixtures", "email-outreach-delivery-send.json");
const own = oas.$referenced_components;

const PREFIX = "sender-";
const COPY_ID = "email-delivery-subflow";
const clone = (value) => structuredClone(value);
const refOf = (node) => node?.$component_ref;
const touches = (edge, step) =>
  [edge.source_node, edge.destination_node, edge.from_node, edge.to_node].some((node) => refOf(node) === step);
const titled = (list, title) => (list ?? []).findIndex((entry) => entry.title === title);

const omitStep = (step) => (flow) => {
  assert.ok(flow.$referenced_components[step], `the flow has no step ${step}`);
  delete flow.$referenced_components[step];
  flow.nodes = flow.nodes.filter((node) => refOf(node) !== step);
  flow.control_flow_connections = flow.control_flow_connections.filter((e) => !touches(e, step));
  flow.data_flow_connections = flow.data_flow_connections.filter((e) => !touches(e, step));
};
const omitEndOutput = (output) => (flow) => {
  const end = flow.$referenced_components.end;
  const at = titled(end.outputs, output);
  const flowAt = titled(flow.outputs, output);
  assert.ok(at >= 0 && flowAt >= 0, `the end has no output ${output}`);
  end.outputs.splice(at, 1);
  flow.outputs.splice(flowAt, 1);
  flow.data_flow_connections = flow.data_flow_connections.filter(
    (e) => !(refOf(e.destination_node) === "end" && e.destination_input === output),
  );
};
const addEndOutput = (from, output) => (flow) => {
  const declaration = flow.$referenced_components[from].outputs[titled(flow.$referenced_components[from].outputs, output)];
  assert.ok(declaration, `${from} has no output ${output}`);
  assert.equal(titled(flow.$referenced_components.end.outputs, output), -1, `the end already has ${output}`);
  flow.$referenced_components.end.outputs.push(clone(declaration));
  flow.outputs.push(clone(declaration));
};
/**
 * The contract of an omit-input on a start step: the input leaves EVERY place
 * that names it, so the copy's start has no trace of it. These are the step's
 * inputs, the flow's inputs, the step's outputs where it declares any, every
 * data edge that leaves the start through it, and, in the step's metadata
 * (metadata.cinatra), the lists required and hidden and the maps inputRenderers,
 * inputTitles and inputDataSources, which the host reads by input name. A map
 * or list left empty by it stays as an empty member's absence: an emptied key
 * is removed.
 */
const START_METADATA_LISTS = ["required", "hidden"];
const START_METADATA_MAPS = ["inputRenderers", "inputTitles", "inputDataSources"];
const omitStartInput = (input) => (flow) => {
  const start = flow.$referenced_components.start;
  for (const owner of [start, flow]) {
    const at = titled(owner.inputs, input);
    assert.ok(at >= 0, "an owner has no input " + input);
    owner.inputs.splice(at, 1);
  }
  if (Array.isArray(start.outputs)) {
    const at = titled(start.outputs, input);
    if (at >= 0) start.outputs.splice(at, 1);
  }
  flow.data_flow_connections = flow.data_flow_connections.filter((e) => !(refOf(e.source_node) === "start" && e.source_output === input));
  const meta = start.metadata?.cinatra;
  if (meta) {
    for (const key of START_METADATA_LISTS) {
      if (Array.isArray(meta[key])) {
        meta[key] = meta[key].filter((name) => name !== input);
        if (meta[key].length === 0) delete meta[key];
      }
    }
    for (const key of START_METADATA_MAPS) {
      if (meta[key] && typeof meta[key] === "object") {
        delete meta[key][input];
        if (Object.keys(meta[key]).length === 0) delete meta[key];
      }
    }
  }
};
const dataEdgeToEnd = (from, output) => (flow) => {
  flow.data_flow_connections.push({
    component_type: "DataFlowEdge",
    name: `${from}_to_end_${output}`,
    source_node: { $component_ref: from },
    source_output: output,
    destination_node: { $component_ref: "end" },
    destination_input: output,
  });
};

/**
 * What differs between this flow and the outreach's prepare copy, and why, in
 * the order the outreach's list applies them. Each entry makes its change and
 * checks that it still applies to the flow.
 */
const DIFFERENCES = [
  {
    name: "omit-flow-key description",
    why: "It describes this package; the outreach declares the run's screens and package once.",
    apply(flow) {
      assert.ok(Object.hasOwn(flow, "description"));
      delete flow.description;
    },
  },
  {
    name: "omit-flow-key metadata",
    why: "It is this package's own metadata; the outreach declares the run's screens and package once.",
    apply(flow) {
      assert.ok(Object.hasOwn(flow, "metadata"));
      delete flow.metadata;
    },
  },
  {
    name: "omit-step delivery_summary",
    why: "The closing sentence of this flow; the outreach ends once, in its own campaign summary.",
    apply: omitStep("delivery_summary"),
  },
  {
    name: "omit-step send",
    why: "The send is the publishing step and cannot be nested; the outreach carries it to its top level unchanged.",
    apply: omitStep("send"),
  },
  ...["sendStatus", "sentCount", "sendErrorMessage", "alreadySentCount", "inDoubtCount"].map((output) => ({
    name: `omit-output end ${output}`,
    why: "The send's answer is the carried send's, not the copy's; the copy ends once the send is prepared.",
    apply: omitEndOutput(output),
  })),
  {
    name: "omit-input start senderEmail",
    why: "Only the send takes the sender; the copy prepares the recipients and the emails and needs none. The input leaves every place that names it.",
    apply: omitStartInput("senderEmail"),
  },
  ...["recipients", "emailBodies", "callToAction"].map((output) => ({
    name: `add-output end ${output} from resolve_send`,
    why: "The copy hands on what the read step resolved, which the carried send takes as its inputs.",
    apply: addEndOutput("resolve_send", output),
  })),
  ...["recipients", "emailBodies", "callToAction"].map((output) => ({
    name: `data-edge resolve_send to end ${output}`,
    why: "Feeds the end's output from the read step.",
    apply: dataEdgeToEnd("resolve_send", output),
  })),
  {
    name: "control-edge resolve_send to end",
    why: "The copy ends after the read step; the carried send runs after the copy.",
    apply(flow) {
      flow.control_flow_connections.push({
        component_type: "ControlFlowEdge",
        name: "resolve_send_to_end",
        from_node: { $component_ref: "resolve_send" },
        to_node: { $component_ref: "end" },
      });
    },
  },
];

/**
 * Every name a flow's steps use that the step does not have: the start's
 * metadata (required, hidden, and the maps keyed by input name) against the
 * start's inputs, the flow's inputs against the start's, a step's card rows and
 * its call and message templates against the step's own inputs, and each data
 * edge's two ends against the outputs and inputs of the steps it joins.
 */
function dangling(flow) {
  const found = [];
  const steps = flow.$referenced_components;
  const names = (list) => new Set((list ?? []).map((entry) => entry.title));
  const start = Object.values(steps).find((step) => step.component_type === "StartNode");
  if (start) {
    const have = names(start.inputs);
    const meta = start.metadata?.cinatra ?? {};
    for (const key of START_METADATA_LISTS) for (const name of meta[key] ?? []) if (!have.has(name)) found.push(`${start.id}.metadata.cinatra.${key} names ${name}`);
    for (const key of START_METADATA_MAPS) for (const name of Object.keys(meta[key] ?? {})) if (!have.has(name)) found.push(`${start.id}.metadata.cinatra.${key} names ${name}`);
    const own = [...names(flow.inputs)].sort().join();
    if (own !== [...have].sort().join()) found.push(`the flow's inputs (${own}) differ from the start's`);
  }
  for (const step of Object.values(steps)) {
    const inputs = names(step.inputs);
    const meta = step.metadata?.cinatra ?? {};
    for (const row of meta.publishRows ?? []) if (!inputs.has(row.input)) found.push(`${step.id} row ${row.label} names input ${row.input}`);
    if (step.component_type === "ApiNode" || step.component_type === "OutputMessageNode") {
      const text = JSON.stringify(step.data ?? step.message ?? "");
      const used = new Set([...text.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]));
      for (const name of used) if (name !== "CINATRA_BASE_URL" && !inputs.has(name)) found.push(`${step.id} renders ${name}, which is no input of it`);
    }
  }
  for (const edge of flow.data_flow_connections) {
    const from = steps[refOf(edge.source_node)];
    const to = steps[refOf(edge.destination_node)];
    if (!from || !to) { found.push(`edge ${edge.name} joins a step that is absent`); continue; }
    const gives = from.component_type === "StartNode" ? from.inputs : from.outputs;
    const takes = to.component_type === "EndNode" ? to.outputs : to.inputs;
    if (titled(gives, edge.source_output) < 0) found.push(`edge ${edge.name}: ${from.id} has no ${edge.source_output}`);
    if (titled(takes, edge.destination_input) < 0) found.push(`edge ${edge.name}: ${to.id} has no ${edge.destination_input}`);
  }
  return found;
}

/** The generator's prefix: on every step id and key, every reference, every edge name and a filing step's node_id. */
function prefixed(flow) {
  const refs = {};
  for (const [key, step] of Object.entries(flow.$referenced_components)) {
    const data = step.data;
    if (data && typeof data === "object" && data.tool === "artifact_materialize" && data.input?.node_id === step.id) {
      data.input.node_id = PREFIX + step.id;
    }
    if (step.name === step.id) step.name = PREFIX + step.id;
    step.id = PREFIX + step.id;
    refs[PREFIX + key] = step;
  }
  flow.$referenced_components = refs;
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value === null || typeof value !== "object") return;
    if (typeof value.$component_ref === "string") value.$component_ref = PREFIX + value.$component_ref;
    Object.values(value).forEach(walk);
  };
  walk(flow);
  for (const edge of [...flow.control_flow_connections, ...flow.data_flow_connections]) edge.name = PREFIX + edge.name;
  return flow;
}

function expectedCopy() {
  const flow = clone(oas);
  for (const difference of DIFFERENCES) difference.apply(flow);
  const out = prefixed(flow);
  out.id = COPY_ID;
  return out;
}

/** A step of the copy with the prefix taken off again, to compare it with this flow's step. */
function unprefixed(key) {
  const step = clone(copy.$referenced_components[PREFIX + key]);
  assert.equal(step.id, PREFIX + key);
  step.id = key;
  if (step.name === PREFIX + key) step.name = key;
  if (step.data?.input?.node_id === PREFIX + key) step.data.input.node_id = key;
  return step;
}

test("the prepare copy is this flow, prefixed, with exactly the named differences", () => {
  assert.deepStrictEqual(copy, expectedCopy());
});

test("the send is carried to the outreach's top level exactly as this flow has it, publishing and with its card", () => {
  assert.deepStrictEqual(carried, own.send);
  const cinatra = carried.metadata.cinatra;
  assert.equal(cinatra.publishes, true);
  assert.deepStrictEqual(cinatra.publishRows, own.send.metadata.cinatra.publishRows);
  assert.ok(cinatra.publishRows.length >= 1);
  assert.deepStrictEqual(cinatra.confirmations, own.send.metadata.cinatra.confirmations);
  assert.equal(cinatra.renderer, own.send.metadata.cinatra.renderer);
  assert.equal(cinatra.riskClass, "email_send");
  assert.equal(carried.id, "send");
});

test("the copy's two tool steps are this flow's, the id aside", () => {
  for (const key of ["file_recipients", "resolve_send"]) {
    assert.deepStrictEqual(unprefixed(key), own[key], `${key} differs from this flow's`);
  }
});

test("the copy only prepares: the four steps in one line, no publishing step, no step that waits for a person, no model step", () => {
  const steps = copy.$referenced_components;
  assert.deepStrictEqual(Object.keys(steps), [`${PREFIX}start`, `${PREFIX}file_recipients`, `${PREFIX}resolve_send`, `${PREFIX}end`]);
  assert.deepStrictEqual(copy.nodes.map(refOf), Object.keys(steps));
  assert.deepStrictEqual(
    copy.control_flow_connections.map((e) => `${refOf(e.from_node)}>${refOf(e.to_node)}`),
    [`${PREFIX}start>${PREFIX}file_recipients`, `${PREFIX}file_recipients>${PREFIX}resolve_send`, `${PREFIX}resolve_send>${PREFIX}end`],
  );
  for (const step of Object.values(steps)) {
    assert.ok(!["InputMessageNode", "OutputMessageNode", "AgentNode", "LlmNode", "FlowNode"].includes(step.component_type), `${step.id} is a ${step.component_type}`);
    assert.notEqual(step.metadata?.cinatra?.publishes, true, `${step.id} publishes`);
    assert.equal(step.metadata?.cinatra?.publishRows, undefined, `${step.id} declares card rows`);
    assert.equal(step.metadata?.cinatra?.confirmations, undefined, `${step.id} declares confirmations`);
    for (const key of ["system", "user", "agent_id", "cinatra_llm"]) assert.equal(Object.hasOwn(step.data ?? {}, key), false, `${step.id} carries the model key ${key}`);
  }
  assert.deepStrictEqual(copy.inputs.map((i) => i.title), ["agent_run_id", "confirmedRecipientsRef", "approvedDraftBundleRef", "campaignId", "emailBodies", "callToAction"]);
});

test("the copy's end hands on what the read step resolved, and the carried send takes everything else from the outreach's own values", () => {
  const end = copy.$referenced_components[`${PREFIX}end`];
  const resolved = ["recipients", "emailBodies", "callToAction"];
  assert.deepStrictEqual(end.outputs.map((o) => o.title), resolved);
  assert.deepStrictEqual(copy.outputs, end.outputs);
  for (const title of resolved) {
    const feeds = copy.data_flow_connections.filter((e) => refOf(e.destination_node) === `${PREFIX}end` && e.destination_input === title);
    assert.deepStrictEqual(feeds.map((e) => `${refOf(e.source_node)}.${e.source_output}`), [`${PREFIX}resolve_send.${title}`]);
    assert.deepStrictEqual(end.outputs.find((o) => o.title === title), own.resolve_send.outputs.find((o) => o.title === title));
  }
  const sendInputs = carried.inputs.map((i) => i.title).sort();
  const fromCopy = resolved;
  const fromParent = ["agent_run_id", "approvedDraftBundleRef", "campaignId", "confirmedRecipientsRef", "senderEmail"];
  assert.deepStrictEqual(sendInputs, [...fromCopy, ...fromParent].sort(), "the carried send takes an input that neither the copy nor the outreach supplies");
});

test("no step of the copy, and no step of this flow or of the carried send, names an input or an output it does not have", () => {
  assert.deepStrictEqual(dangling(copy), []);
  assert.deepStrictEqual(dangling(oas), []);
  assert.deepStrictEqual(dangling({ ...clone(oas), $referenced_components: { send: carried }, data_flow_connections: [], inputs: [] }).filter((line) => !line.startsWith("the flow's inputs")), []);
  // The check is not empty: each of these leaves a name behind.
  const left = (change) => {
    const flow = clone(copy);
    change(flow);
    return dangling(flow);
  };
  const start = (flow) => flow.$referenced_components[`${PREFIX}start`];
  assert.match(left((f) => start(f).metadata.cinatra.required.push("senderEmail")).join(), /required names senderEmail/);
  assert.match(left((f) => (start(f).metadata.cinatra.inputRenderers = { senderEmail: "x" })).join(), /inputRenderers names senderEmail/);
  assert.match(left((f) => start(f).metadata.cinatra.hidden.push("senderEmail")).join(), /hidden names senderEmail/);
  assert.match(left((f) => (start(f).metadata.cinatra.inputTitles = { senderEmail: "x" })).join(), /inputTitles names senderEmail/);
  assert.match(left((f) => f.inputs.push({ title: "senderEmail", type: "string" })).join(), /flow's inputs/);
  assert.match(left((f) => f.$referenced_components[`${PREFIX}resolve_send`].data.input.input.callToAction = "{{ senderEmail }}").join(), /renders senderEmail/);
  assert.match(left((f) => f.data_flow_connections[0].source_output = "senderEmail").join(), /has no senderEmail/);
});

test("the start's metadata names only the copy's own inputs", () => {
  const start = copy.$referenced_components[`${PREFIX}start`];
  const meta = start.metadata.cinatra;
  assert.deepStrictEqual(meta.required, ["callToAction"]);
  assert.deepStrictEqual(meta.hidden, ["agent_run_id", "confirmedRecipientsRef", "approvedDraftBundleRef", "campaignId", "emailBodies"]);
  assert.equal(Object.hasOwn(meta, "inputRenderers"), false);
  assert.ok(!JSON.stringify(start).includes("senderEmail"), "the copy's start still names senderEmail");
  assert.ok(!JSON.stringify(copy.inputs).includes("senderEmail"), "the copy's inputs still name senderEmail");
});

test("the named differences are the whole list, each with a reason", () => {
  assert.equal(DIFFERENCES.length, 17);
  for (const difference of DIFFERENCES) assert.ok(difference.why.trim().length > 0, difference.name);
});
