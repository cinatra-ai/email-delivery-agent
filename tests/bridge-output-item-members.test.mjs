// Bridge-output item members (issue #40).
//
// The runtime asks the model for exactly the shape this agent declares: the
// loader derivation (the host's docker/wayflow/agent_loader.py) reads an
// ApiNode output that targets /api/llm-bridge and emits a closed EMPTY object
// for a declared object that names no members, reporting that output as
// undeclared. The flow's one bridge output, the prepare step's summary,
// therefore declares its members in this package's own OAS, in the fleet
// spelling: a json_schema block with a properties map and a required list
// naming every member.
//
// The member names are the ones the prepare step's system prompt spells out
// and the send-confirmation renderer of @cinatra-ai/email-artifacts reads.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra/oas.json"), "utf8"));
const components = oas.$referenced_components ?? {};

const BRIDGE_PATH = "/api/llm-bridge";

function bridgeOutput(nodeId, title) {
  const node = components[nodeId];
  assert.ok(node, `node ${nodeId} is missing`);
  assert.equal(node.component_type, "ApiNode");
  assert.ok(
    typeof node.url === "string" && node.url.endsWith(BRIDGE_PATH),
    `node ${nodeId} does not target the LLM bridge`,
  );
  const output = (node.outputs ?? []).find((o) => o?.title === title);
  assert.ok(output, `node ${nodeId} declares no output ${title}`);
  return output;
}

function declaredMembers(output) {
  // Either agentspec spelling, the same fallback the runtime derivation applies.
  const direct = output.properties;
  if (direct && typeof direct === "object" && Object.keys(direct).length > 0) return direct;
  const nested = output.json_schema?.properties;
  if (nested && typeof nested === "object" && Object.keys(nested).length > 0) return nested;
  return null;
}

function declaredRequired(output) {
  const direct = output.required;
  if (Array.isArray(direct)) return direct;
  const nested = output.json_schema?.required;
  return Array.isArray(nested) ? nested : [];
}

test("prepare/summary declares its item members", () => {
  const output = bridgeOutput("prepare", "summary");
  const members = declaredMembers(output);
  assert.ok(members, "prepare/summary declares no members (reads free-form)");
  assert.deepEqual(Object.keys(members).sort(), [
    "draftCount",
    "recipientCount",
    "scheduledAt",
  ]);
  assert.equal(members.recipientCount.type, "integer");
  assert.equal(members.draftCount.type, "integer");
  assert.equal(members.scheduledAt.type, "string");
  // The strict structured-output contract has no optional key: the runtime
  // widens required to every declared member, so the declaration says so.
  assert.deepEqual(declaredRequired(output).sort(), Object.keys(members).sort());
});

test("the bridge output is not left to a free-form disclosure sentence, and the send is no bridge step", () => {
  for (const [nodeId, title] of [["prepare", "summary"]]) {
    const output = bridgeOutput(nodeId, title);
    assert.ok(
      declaredMembers(output),
      `${nodeId}/${title} still names no members`,
    );
  }
  // The send step is a passthrough call of the send start; its outputs are the members of that answer, not a model's
  // structured output (tests/send-follows-the-publish-decision.test.mjs holds them).
  assert.ok(!String(components.send?.url).endsWith(BRIDGE_PATH), "the send step targets the LLM bridge");
});
