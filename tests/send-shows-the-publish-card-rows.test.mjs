// The publish card shows what the send changes - cinatra-ai/cinatra#3745 and
// cinatra-ai/cinatra#3089.
//
// Sending an email is an external write. The application stops the run in
// front of the send step and shows its publish card; the rows of that card
// are the ones the send step declares under metadata.cinatra.publishRows, each
// over one of the step's own inputs. A row holds what a person can judge,
// never an internal identifier. The send step declares four rows:
//   - From: the sending mailbox (a text row over senderEmail);
//   - Recipients: the recipients, one line each with name, email and company
//     (a list row over recipients);
//   - Emails: the approved email bodies, the artifact revisions the run made
//     (an artifacts row over emailBodies);
//   - Call to action: the call to action of the emails (a text row over
//     callToAction).
// There is no campaign row: a campaign id is an internal identifier.
//
// These arms hold that the declaration has the form the host's compiler reads
// (the row grammar of packages/agents/src/oas-compiler.ts, collectPublishRows),
// that every row's value reaches the send step from the start node, so a
// parent can feed it, and that the send's texts and the prepare step's digest
// still say what the flow does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const refs = oas.$referenced_components ?? {};

const SEND_TOOL = "email_outreach_send_initial_start";
const PREVIEW_TOOL = "email_outreach_send_initial_preview";
const SEND = "send";
const PREPARE = "prepare";
const ARGUMENTS = ["approvedDraftBundleRef", "campaignId", "confirmedRecipientsRef", "contentDigest", "senderEmail"];
const ROW_INPUTS = ["senderEmail", "recipients", "emailBodies", "callToAction"];
// The card's own inputs, which only the card reads (senderEmail is also an argument of the send).
const CARD_INPUTS = ["recipients", "emailBodies", "callToAction"];

const EXPECTED_ROWS = [
  { label: "From", input: "senderEmail" },
  {
    kind: "list",
    label: "Recipients",
    input: "recipients",
    columns: [
      { label: "Name", field: "name" },
      { label: "Email", field: "email" },
      { label: "Company", field: "company" },
    ],
  },
  { kind: "artifacts", label: "Emails", input: "emailBodies" },
  { label: "Call to action", input: "callToAction" },
];

const refOf = (node) => node?.$component_ref;
const titles = (list) => (list ?? []).map((entry) => entry.title);
const inputOf = (owner, title) => (owner.inputs ?? []).find((entry) => entry.title === title);
const dataEdges = oas.data_flow_connections ?? [];

/** The one data-flow edge into a step's input, as "<source step>.<output>". */
function sourceOf(step, input) {
  const into = dataEdges.filter((e) => refOf(e.destination_node) === step && e.destination_input === input);
  assert.equal(into.length, 1, `${step}.${input} is fed by ${into.length} data-flow edges, not one`);
  return `${refOf(into[0].source_node)}.${into[0].source_output}`;
}

test("the send step declares the four rows, From, Recipients, Emails and Call to action (red: a row added, removed, reordered or relabelled)", () => {
  assert.equal(refs[SEND].metadata.cinatra.publishes, true, "the rows sit beside publishes true");
  assert.deepEqual(refs[SEND].metadata.cinatra.publishRows, EXPECTED_ROWS);
});

test("every row is in the form the host's compiler reads", () => {
  const rows = refs[SEND].metadata.cinatra.publishRows;
  assert.ok(rows.length >= 1 && rows.length <= 4, "one to four rows");
  const sendInputs = titles(refs[SEND].inputs);
  const isLabel = (s, max) => typeof s === "string" && s.trim() !== "" && s === s.trim() && s.length <= max && !/[\r\n]/.test(s);
  const seen = new Set();
  for (const row of rows) {
    const kind = Object.hasOwn(row, "kind") ? row.kind : "text";
    assert.ok(["text", "list", "artifacts"].includes(kind), `row ${row.label}: kind ${kind}`);
    const keys = kind === "list" ? "columns,input,kind,label" : Object.hasOwn(row, "kind") ? "input,kind,label" : "input,label";
    assert.equal(Object.keys(row).sort().join(","), keys, `row ${row.label} has other keys`);
    assert.ok(isLabel(row.label, 60), `row ${row.label}: label`);
    assert.ok(sendInputs.includes(row.input), `row ${row.label} names no input of the send step`);
    assert.ok(!seen.has(row.input), `row ${row.label} repeats an input`);
    seen.add(row.input);
    if (kind === "artifacts") assert.ok(row.input.length <= 128, "an artifacts row's input fits its island ref");
    if (kind === "list") {
      assert.ok(row.columns.length >= 1 && row.columns.length <= 4);
      const fields = new Set();
      for (const column of row.columns) {
        assert.equal(Object.keys(column).sort().join(","), "field,label");
        assert.ok(isLabel(column.label, 60));
        assert.ok(isLabel(column.field, 64));
        assert.ok(!fields.has(column.field));
        fields.add(column.field);
      }
    }
  }
  assert.deepEqual([...seen], ROW_INPUTS);
});

test("no row shows an internal identifier (red: a row over the campaign, a reference, the digest or the run)", () => {
  const shown = refs[SEND].metadata.cinatra.publishRows.map((row) => row.input);
  for (const hidden of ["campaignId", "approvedDraftBundleRef", "confirmedRecipientsRef", "contentDigest", "agent_run_id"]) {
    assert.ok(!shown.includes(hidden), `a row shows ${hidden}`);
  }
});

test("every row's value reaches the send step from the start node, and the flow takes it as an input (red: a row input with no source, or fed from another step)", () => {
  const startInputs = titles(refs.start.inputs);
  const flowInputs = titles(oas.inputs);
  for (const name of ROW_INPUTS) {
    assert.equal(sourceOf(SEND, name), `start.${name}`, `${name} does not come from the start node`);
    assert.ok(startInputs.includes(name), `the start node takes no input ${name}`);
    assert.ok(flowInputs.includes(name), `the flow takes no input ${name}`);
  }
});

test("the card's inputs are typed for their rows and default to empty, so a run with no parent still mounts", () => {
  for (const owner of [oas, refs.start, refs[SEND]]) {
    const recipients = inputOf(owner, "recipients");
    assert.equal(recipients.type, "array");
    assert.deepEqual(recipients.default, []);
    assert.deepEqual(Object.keys(recipients.json_schema.items.properties).sort(), ["company", "email", "name"]);
    const bodies = inputOf(owner, "emailBodies");
    assert.equal(bodies.type, "array");
    assert.deepEqual(bodies.default, []);
    // The shape an artifacts row reads: a list of { artifactId, representationRevisionId }.
    assert.deepEqual(bodies.json_schema.items.required, ["artifactId", "representationRevisionId"]);
    const cta = inputOf(owner, "callToAction");
    assert.equal(cta.type, "string");
    assert.equal(cta.default, "");
  }
  const hidden = refs.start.metadata.cinatra.hidden;
  assert.ok(hidden.includes("recipients") && hidden.includes("emailBodies"), "the structured card inputs are on the run form");
  assert.ok(!refs.start.metadata.cinatra.required.some((name) => CARD_INPUTS.includes(name)), "a card input is required");
});

test("the card's inputs reach the send step's template only through the input hint, never its rendered text", () => {
  const { system, user } = refs[SEND].data;
  const hint = user.match(/^\{#[^#]*#\}/);
  assert.ok(hint, "the send's input text opens with no input hint");
  for (const name of CARD_INPUTS) {
    assert.ok(hint[0].includes(`{{ ${name} }}`), `the hint does not name ${name}`);
    assert.ok(!user.slice(hint[0].length).includes(name), `the send's rendered input text carries ${name}`);
    assert.ok(!system.includes(`{{ ${name} }}`), `the send's system text renders ${name}`);
  }
});

test("the prepare step takes the digest from the read-only preview tool and never computes one", () => {
  const prepare = refs[PREPARE];
  const output = (prepare.outputs ?? []).find((entry) => entry.title === "contentDigest");
  assert.ok(output, "the prepare step declares no contentDigest output");
  assert.equal(output.type, "string");
  assert.equal(sourceOf(SEND, "contentDigest"), `${PREPARE}.contentDigest`);
  const system = prepare.data.system;
  assert.ok(system.includes(PREVIEW_TOOL), "the prepare text does not name the preview tool");
  assert.ok(system.includes('"contentDigest"'), "the prepare text does not name the contentDigest key");
  assert.ok(system.includes("exactly as the tool returned it"), "the prepare text does not say that the digest is handed on unchanged");
  assert.ok(system.includes('set "contentDigest" to the empty string ""'), "the prepare text does not say what a failed preview hands on");
  assert.ok(system.includes("NEVER compute"), "the prepare text does not forbid a computed digest");
  assert.equal(prepare.metadata.cinatra.riskClass, "read_only");
  assert.ok(!system.includes(SEND_TOOL), "the prepare text names the send start");
  assert.doesNotMatch(system, /confirmation gate/, "the prepare text names a confirmation gate the flow no longer has");
});

test("the send texts name the five arguments and no other key, and name the publish card as the one place the person decides", () => {
  const { system, user } = refs[SEND].data;
  const block = system.match(/```json\n(\{\n {2}"campaignId"[\s\S]*?\n\})\n```/);
  assert.ok(block, "the send text carries no argument block for the send start");
  assert.deepEqual(Object.keys(JSON.parse(block[1])).sort(), ARGUMENTS);
  assert.ok(system.includes("with these five arguments and no other key"));
  // The send start's own schema refuses an empty or null reference, so a key whose input is empty is left out.
  assert.ok(system.includes("Leave out a key whose input is empty"), "the send text does not say how an empty value is passed");
  assert.ok(!system.includes("pass JSON null"), "the send text still passes null for an empty value");
  for (const name of ARGUMENTS) {
    assert.ok(user.includes(`- ${name}: {{ ${name} }}`), `the send's input text carries no line for ${name}`);
  }
  assert.ok(!system.includes(PREVIEW_TOOL), "the send text names the preview tool, which the step does not offer");
  assert.ok(system.includes("publish card"), "the send text does not name the publish card");
  for (const text of [system, user, refs[SEND].metadata.cinatra.description, oas.description]) {
    assert.doesNotMatch(text, /confirmation gate|send-confirmation|at the gate/i, "a text names the confirmation gate the flow no longer has");
  }
});
