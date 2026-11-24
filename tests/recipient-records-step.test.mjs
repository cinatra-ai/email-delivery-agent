// The recipient filing step of the delivery flow and its declared module -
// cinatra-ai/cinatra#3089.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const MODULE_PATH = "./cinatra/tools/recipient-records.mjs";

const components = oas.$referenced_components;
const componentList = Array.isArray(components) ? components : Object.values(components);
const byId = (id) => componentList.find((c) => c.id === id);

const controlEdges = () =>
  oas.control_flow_connections.map((e) => [e.from_node.$component_ref, e.to_node.$component_ref]);
const into = (id) => controlEdges().filter(([, to]) => to === id).map(([from]) => from);

test("S1 the manifest declares the recipient_records tool and its module loads", async () => {
  assert.deepEqual(pkg.cinatra.tools, [{ name: "recipient_records", module: MODULE_PATH, embeddable: true }]);
  const { name, module } = pkg.cinatra.tools[0];
  assert.match(name, /^[a-z][a-z0-9_]*$/);
  assert.ok(module.startsWith("./"));
  assert.ok(!module.split("/").includes(".."));
  assert.ok(module.endsWith(".mjs"));
  assert.ok(existsSync(join(root, module)));
  assert.ok(pkg.files.includes("cinatra"));
  const loaded = await import(new URL(`../${module.slice(2)}`, import.meta.url));
  assert.equal(typeof loaded.extensionTool, "function");
  assert.equal(loaded.extensionTool.length, 1);
});

test("S2 the file_recipients component has the declared shape", () => {
  const component = structuredClone(byId("file_recipients"));
  assert.ok(component, "file_recipients is a referenced component");
  const description = component.metadata?.cinatra?.description;
  assert.equal(typeof description, "string");
  assert.ok(description.trim().length > 0);
  delete component.metadata.cinatra.description;
  assert.deepEqual(component, {
    component_type: "ApiNode",
    id: "file_recipients",
    name: "File one record per confirmed recipient",
    url: "{{CINATRA_BASE_URL}}/api/agents/passthrough",
    http_method: "POST",
    data: {
      tool: "extension_tool",
      input: {
        name: "recipient_records",
        input: { recipientsRef: "{{ confirmedRecipientsRef }}", campaignId: "{{ campaignId }}" },
      },
      agent_run_id: "{{ agent_run_id }}",
    },
    inputs: [
      { title: "agent_run_id", type: "string", default: "" },
      { title: "confirmedRecipientsRef", type: "string", default: "" },
      { title: "campaignId", type: "string", default: "" },
    ],
    outputs: [
      { title: "filed", type: "integer", default: 0 },
      { title: "skipped", type: "integer", default: 0 },
      { title: "ok", type: "boolean", default: false },
    ],
    metadata: {
      cinatra: {
        riskClass: "write",
        requiresApproval: false,
        packageName: "@cinatra-ai/email-delivery-agent",
        publishes: false,
      },
    },
  });
});

test("S3 the step is listed directly after the prepare step and directly before the send", () => {
  const ids = oas.nodes.map((n) => n.$component_ref);
  assert.equal(ids[ids.indexOf("prepare") + 1], "file_recipients");
  assert.equal(ids[ids.indexOf("file_recipients") + 1], "send");
});

test("S4 the edge list puts the filing step directly before the send", () => {
  const edges = controlEdges().map(([a, b]) => `${a} -> ${b}`);
  assert.deepEqual(edges, [
    "start -> prepare",
    "prepare -> file_recipients",
    "file_recipients -> send",
    "send -> delivery_summary",
    "delivery_summary -> end",
  ]);
  assert.deepEqual(into("file_recipients"), ["prepare"]);
  assert.deepEqual(into("send"), ["file_recipients"]);
});

test("S4b the filing step declares that it makes no external write, and the send is the flow's one publishing step", () => {
  assert.equal(byId("file_recipients").metadata.cinatra.publishes, false);
  const publishing = componentList.filter((c) => c.metadata?.cinatra?.publishes === true).map((c) => c.id);
  assert.deepEqual(publishing, ["send"]);
});

test("S5 the data edges into file_recipients are the three start inputs, each once", () => {
  const edges = oas.data_flow_connections
    .filter((e) => e.destination_node.$component_ref === "file_recipients")
    .map((e) => [e.source_node.$component_ref, e.source_output, e.destination_input]);
  assert.deepEqual(edges, [
    ["start", "agent_run_id", "agent_run_id"],
    ["start", "confirmedRecipientsRef", "confirmedRecipientsRef"],
    ["start", "campaignId", "campaignId"],
  ]);
});

test("S7 no path from start reaches the send without passing the filing step", () => {
  const edges = controlEdges();
  const reach = (blocked) => {
    const seen = new Set();
    const queue = [oas.start_node.$component_ref];
    while (queue.length > 0) {
      const id = queue.shift();
      if (seen.has(id) || id === blocked) continue;
      seen.add(id);
      for (const [from, to] of edges) if (from === id) queue.push(to);
    }
    return seen;
  };
  const open = reach(null);
  assert.ok(open.has("file_recipients"));
  assert.ok(open.has("send"));
  assert.ok(!reach("file_recipients").has("send"));
});

test("S6 the module names no run or external key and imports nothing", () => {
  const source = readFileSync(join(root, MODULE_PATH.slice(2)), "utf8");
  for (const word of ["agent_run_id", "cinatra_agent_run_id", "cinatra_run_id", "cinatraAgentRunId", "externalId", "external_id"]) {
    assert.ok(!source.includes(word), word);
  }
  assert.ok(!/^\s*import[\s({"']/m.test(source));
  assert.ok(!/\bimport\s*\(/.test(source));
});
