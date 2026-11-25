// Parity of this flow with its embedded copy - cinatra-ai/cinatra#3096 item (7)
// and cinatra-ai/cinatra#3089.
//
// The outreach pack (@cinatra-ai/email-outreach-agent) runs this agent as an
// embedded copy of this flow. The fixture
// tests/fixtures/email-outreach-delivery-subflow.json is that copy taken whole:
// the value of "email-delivery-subflow" that the outreach pack's generator
// (scripts/embedded-copies.mjs at cinatra-ai/email-outreach-agent 12bb5e2)
// writes from this flow with the delivery entries of its
// scripts/embedded-copies.json, as this flow's publishing send needs them.
//
// The rule is EQUALITY: the copy is this flow with the generator's prefix
// "sender-" on every step id, reference and edge name, and with exactly the
// differences named in DIFFERENCES below and nothing else. Every step of the
// flow, the read step and the publishing send included, every input and output
// and every edge is compared. Each named difference must still apply to this
// flow, so a difference that no longer has a reason fails here as well.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const copy = JSON.parse(readFileSync(join(root, "tests", "fixtures", "email-outreach-delivery-subflow.json"), "utf8"));

const PREFIX = "sender-";
const COPY_ID = "email-delivery-subflow";
const refOf = (node) => node?.$component_ref;
const clone = (value) => structuredClone(value);
const touches = (edge, step) =>
  [edge.source_node, edge.destination_node, edge.from_node, edge.to_node].some((node) => refOf(node) === step);

/**
 * What may differ between this flow and its embedded copy, and why. Each entry
 * checks that it still applies to the flow and then makes its change.
 */
const DIFFERENCES = [
  {
    name: "the flow's description and metadata are left out",
    why: "They describe this package; the outreach declares the run's screens and package once.",
    apply(flow) {
      for (const key of ["description", "metadata"]) {
        assert.ok(Object.hasOwn(flow, key), `the flow has no ${key}`);
        delete flow[key];
      }
    },
  },
  {
    name: "the closing sentence (delivery_summary) is left out and the send goes straight to the end",
    why: "The outreach ends once, in its own campaign summary after the copy.",
    apply(flow) {
      assert.ok(flow.$referenced_components.delivery_summary, "the flow has no closing sentence");
      delete flow.$referenced_components.delivery_summary;
      flow.nodes = flow.nodes.filter((node) => refOf(node) !== "delivery_summary");
      flow.control_flow_connections = flow.control_flow_connections.filter((e) => !touches(e, "delivery_summary"));
      flow.data_flow_connections = flow.data_flow_connections.filter((e) => !touches(e, "delivery_summary"));
      assert.ok(!flow.control_flow_connections.some((e) => refOf(e.from_node) === "send" && refOf(e.to_node) === "end"));
      flow.control_flow_connections.push({
        component_type: "ControlFlowEdge",
        name: "send_to_end",
        from_node: { $component_ref: "send" },
        to_node: { $component_ref: "end" },
      });
    },
  },
  {
    name: "inside the copy the send is not a publishing step: publishes is false and it declares no card rows",
    why:
      "Only a top-level node can be a publishing step (the run is stopped in front of it); the outreach's " +
      "sender_flow node, which runs the copy, publishes, and its decision authorizes the nested send. A nested " +
      "send with publishes true, or with card rows, refuses the outreach's compile.",
    apply(flow) {
      const cinatra = flow.$referenced_components.send.metadata.cinatra;
      assert.equal(cinatra.publishes, true, "the flow's send does not publish");
      assert.ok(Array.isArray(cinatra.publishRows), "the flow's send declares no card rows");
      cinatra.publishes = false;
      delete cinatra.publishRows;
    },
  },
];

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

test("(7) the embedded copy is this flow, prefixed, with exactly the named differences", () => {
  assert.deepStrictEqual(copy, expectedCopy());
});

test("(7) the copy carries the read step and the publishing send's call unchanged", () => {
  const steps = copy.$referenced_components;
  for (const step of ["resolve_send", "send", "file_recipients", "start", "end"]) {
    assert.ok(steps[PREFIX + step], `the copy has no step ${step}`);
  }
  assert.deepStrictEqual(steps[`${PREFIX}send`].data, oas.$referenced_components.send.data);
  assert.deepStrictEqual(steps[`${PREFIX}send`].inputs, oas.$referenced_components.send.inputs);
  assert.deepStrictEqual(steps[`${PREFIX}send`].outputs, oas.$referenced_components.send.outputs);
  assert.deepStrictEqual(steps[`${PREFIX}resolve_send`].data, oas.$referenced_components.resolve_send.data);
  assert.deepStrictEqual(copy.inputs, oas.inputs);
  assert.deepStrictEqual(copy.outputs, oas.outputs);
  // The copy's send keeps the send start's confirmation and its risk class; only the card is the outreach's.
  const cinatra = steps[`${PREFIX}send`].metadata.cinatra;
  assert.deepStrictEqual(cinatra.confirmations, oas.$referenced_components.send.metadata.cinatra.confirmations);
  assert.equal(cinatra.riskClass, "email_send");
  assert.equal(cinatra.requiresApproval, false);
});

test("(7) the named differences are the whole list, each with a reason", () => {
  assert.equal(DIFFERENCES.length, 3);
  for (const difference of DIFFERENCES) assert.ok(difference.why.trim().length > 0, difference.name);
});
