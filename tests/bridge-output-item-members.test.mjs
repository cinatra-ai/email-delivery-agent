// Bridge-output item members (issue #40).
//
// The runtime asks the model for exactly the shape this agent declares: the
// loader derivation (the host's docker/wayflow/agent_loader.py) reads an
// ApiNode output that targets /api/llm-bridge and emits a closed EMPTY object
// for a declared object that names no members, reporting that output as
// undeclared. So any object output of a bridge step declares its members in
// this package's own OAS, in the fleet spelling: a json_schema block with a
// properties map and a required list naming every member.
//
// The flow has no bridge step today: the filing, the read and the send are
// passthrough calls. The rule below still holds for every bridge output, so a
// bridge step added later is held to it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra/oas.json"), "utf8"));
const components = oas.$referenced_components ?? {};

const BRIDGE_PATH = "/api/llm-bridge";

const bridgeSteps = () =>
  Object.entries(components).filter(
    ([, node]) => node?.component_type === "ApiNode" && typeof node.url === "string" && node.url.endsWith(BRIDGE_PATH),
  );

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

test("every object output of a bridge step declares its item members, all of them required", () => {
  for (const [nodeId, node] of bridgeSteps()) {
    for (const output of node.outputs ?? []) {
      if (output?.type !== "object") continue;
      const members = declaredMembers(output);
      assert.ok(members, `${nodeId}/${output.title} declares no members (reads free-form)`);
      // The strict structured-output contract has no optional key: the runtime
      // widens required to every declared member, so the declaration says so.
      assert.deepEqual(declaredRequired(output).sort(), Object.keys(members).sort());
    }
  }
});

test("the flow has no bridge step, and the send is no bridge step", () => {
  assert.deepEqual(bridgeSteps().map(([id]) => id), []);
  // The send step is a passthrough call of the send start; its outputs are the members of that answer, not a model's
  // structured output (tests/send-follows-the-publish-decision.test.mjs holds them).
  assert.ok(!String(components.send?.url).endsWith(BRIDGE_PATH), "the send step targets the LLM bridge");
});
