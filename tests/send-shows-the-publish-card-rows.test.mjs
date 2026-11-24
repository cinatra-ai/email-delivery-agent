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
//     callToAction), as the read step hands it on: the read step hands on the
//     caller's call to action only when every mailed body carries it.
// There is no campaign row: a campaign id is an internal identifier.
//
// These arms hold that the declaration has the form the host's compiler reads
// (the row grammar of packages/agents/src/oas-compiler.ts, collectPublishRows),
// that the card shows what the send mails, and that the send's texts and the
// prepare step's digest still say what the flow does.
//
// What the card shows and what the send mails come from one source. The send
// start reads two references, the approved draft bundle and the confirmed
// recipient list, and mails the bundle's drafts. The read step in front of the
// send reads the same two references, from the same start inputs, and resolves
// them into the recipients the send mails and the body revisions of the drafts
// it mails (each one compared with its draft). The Recipients and Emails rows
// take their values from that step only; the From row is the sender the send
// start takes. No value the card shows has an empty default: a run without it
// does not start, and a run whose bodies are not the drafts' bodies ends at the
// read step, so no run reaches an empty or a different card.

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
const READ = "resolve_send";
const READ_TOOL = "send_contents";
const PREPARE = "prepare";
// The send start's arguments; approvedBodies is the list the Emails row shows, rendered from the send step's emailBodies.
const ARGUMENTS = ["approvedBodies", "approvedDraftBundleRef", "campaignId", "confirmedRecipientsRef", "senderEmail"];
const ARGUMENT_SOURCE = { approvedBodies: "emailBodies | tojson" };
const ROW_INPUTS = ["senderEmail", "recipients", "emailBodies", "callToAction"];
// The card's own inputs, which only the card reads (senderEmail and emailBodies are also arguments of the send).
const CARD_INPUTS = ["recipients", "callToAction"];

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

// The card shows what the send mails because one value feeds both: each row's
// input is an input of the send step, fed by one data edge from the start node
// or the read step, and the send step is the model-free passthrough call whose
// arguments render those same inputs. No model sits between the card and the
// send start.
const ROW_SOURCES = {
  senderEmail: "start.senderEmail",
  recipients: `${READ}.recipients`,
  emailBodies: `${READ}.emailBodies`,
  callToAction: `${READ}.callToAction`,
};
test("every row is a value the model-free send step takes from the start node or the read step, and the rows the send mails with are its arguments (red: a model send step, a row fed from another step, or an argument that is not the row's value)", () => {
  const send = refs[SEND];
  assert.equal(send.url, "{{CINATRA_BASE_URL}}/api/agents/passthrough", "the card sits on a step that is not the passthrough call");
  assert.equal(send.data.tool, SEND_TOOL);
  for (const key of ["system", "user", "agent_id"]) assert.equal(Object.hasOwn(send.data, key), false, `the send step carries the model key ${key}`);
  const shown = send.metadata.cinatra.publishRows.map((row) => row.input);
  assert.deepEqual(shown, Object.keys(ROW_SOURCES));
  for (const input of shown) assert.equal(sourceOf(SEND, input), ROW_SOURCES[input], `the ${input} row`);
  const rendered = (value) => value.replace(/^\{#[\s\S]*?#\}/, "");
  assert.equal(rendered(send.data.input.senderEmail), "{{ senderEmail }}", "the send does not mail from the mailbox the From row shows");
  assert.equal(rendered(send.data.input.approvedBodies), "{{ emailBodies | tojson }}", "the send does not mail the bodies the Emails row shows");
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

test("the card's rows and the send's references trace to one source (red: a row fed from the start node past the read step, or the read step and the send reading different references)", () => {
  // The From row is the sender the send start takes.
  assert.equal(sourceOf(SEND, "senderEmail"), "start.senderEmail");
  // The Recipients, Emails and Call to action rows come from the read step only.
  assert.equal(sourceOf(SEND, "recipients"), `${READ}.recipients`);
  assert.equal(sourceOf(SEND, "emailBodies"), `${READ}.emailBodies`);
  assert.equal(sourceOf(SEND, "callToAction"), `${READ}.callToAction`);
  // The read step reads the references the send start reads, from the same start inputs.
  for (const ref of ["approvedDraftBundleRef", "confirmedRecipientsRef"]) {
    assert.equal(sourceOf(SEND, ref), `start.${ref}`);
    assert.equal(sourceOf(READ, ref), `start.${ref}`);
  }
  assert.equal(sourceOf(READ, "emailBodies"), "start.emailBodies");
  assert.equal(sourceOf(READ, "callToAction"), "start.callToAction");
  const call = refs[READ].data;
  assert.equal(call.tool, "extension_tool");
  assert.equal(call.input.name, READ_TOOL);
  assert.equal(call.input.input.recipientsRef, "{{ confirmedRecipientsRef }}");
  assert.equal(call.input.input.draftBundleRef, "{{ approvedDraftBundleRef }}");
  assert.match(call.input.input.emailBodies, /\{\{ emailBodies \| tojson \}\}$/);
  assert.equal(call.input.input.callToAction, "{{ callToAction }}");
  assert.equal(refs[READ].metadata.cinatra.riskClass, "read_only");
  assert.equal(refs[READ].metadata.cinatra.publishes, false);
  // A caller cannot hand in a recipient list of its own: the flow takes none.
  for (const owner of [oas, refs.start]) assert.equal(inputOf(owner, "recipients"), undefined);
  for (const flowInput of ["senderEmail", "callToAction", "emailBodies"]) {
    assert.ok(titles(oas.inputs).includes(flowInput) && titles(refs.start.inputs).includes(flowInput), `the flow takes no input ${flowInput}`);
  }
});

test("no input the card shows has a default, so a run without it does not start and never reaches the card (red: an empty default on a card value)", () => {
  for (const owner of [oas, refs.start]) {
    for (const name of ["senderEmail", "emailBodies", "callToAction"]) {
      assert.equal(Object.hasOwn(inputOf(owner, name), "default"), false, `${name} has a default`);
    }
  }
  for (const name of ROW_INPUTS) {
    assert.equal(Object.hasOwn(inputOf(refs[SEND], name), "default"), false, `the send step's ${name} has a default`);
  }
  for (const name of ["recipients", "emailBodies", "callToAction"]) {
    const output = (refs[READ].outputs ?? []).find((entry) => entry.title === name);
    assert.ok(output, `the read step hands on no ${name}`);
    assert.equal(Object.hasOwn(output, "default"), false, `the read step's ${name} has a default`);
  }
  for (const name of ["emailBodies", "callToAction"]) assert.equal(Object.hasOwn(inputOf(refs[READ], name), "default"), false, `the read step's ${name} has a default`);
  // The run form requires the values a person types; the bodies come from the parent, hidden, and have no default.
  const { required, hidden } = refs.start.metadata.cinatra;
  assert.deepEqual([...required].sort(), ["callToAction", "senderEmail"]);
  assert.ok(hidden.includes("emailBodies"));
});

test("the card's values are typed for their rows", () => {
  for (const bodies of [inputOf(refs[SEND], "emailBodies"), (refs[READ].outputs ?? []).find((entry) => entry.title === "emailBodies")]) {
    assert.equal(bodies.type, "array");
    // The shape an artifacts row reads, a list of { artifactId, representationRevisionId }, with the contact the
    // send start joins each body on.
    assert.deepEqual(bodies.json_schema.items.required, ["artifactId", "representationRevisionId", "contactId"]);
  }
  const recipients = [inputOf(refs[SEND], "recipients"), (refs[READ].outputs ?? []).find((entry) => entry.title === "recipients")];
  for (const entry of recipients) {
    assert.equal(entry.type, "array");
    assert.deepEqual(Object.keys(entry.json_schema.items.properties).sort(), ["company", "email", "name"]);
  }
  assert.equal(inputOf(refs[SEND], "callToAction").type, "string");
  assert.equal((refs[READ].outputs ?? []).find((entry) => entry.title === "callToAction").type, "string");
});

test("the card's own inputs reach the send step's call only through the input hint, never a rendered argument", () => {
  const values = Object.values(refs[SEND].data.input);
  const withHint = values.filter((value) => /^\{#[^#]*#\}/.test(value));
  assert.equal(withHint.length, 1, "the send's call carries no input hint, or more than one");
  const hint = withHint[0].match(/^\{#[^#]*#\}/)[0];
  for (const name of CARD_INPUTS) {
    assert.ok(hint.includes(`{{ ${name} }}`), `the hint does not name ${name}`);
    for (const value of values) assert.ok(!value.replace(/^\{#[^#]*#\}/, "").includes(name), `a rendered argument carries ${name}`);
  }
});

test("the prepare step takes the digest from the read-only preview tool and never computes one", () => {
  const prepare = refs[PREPARE];
  const output = (prepare.outputs ?? []).find((entry) => entry.title === "contentDigest");
  assert.ok(output, "the prepare step declares no contentDigest output");
  assert.equal(output.type, "string");
  // The digest is the prepare step's own output; the send start mails the approved bodies and takes no digest.
  assert.equal(inputOf(refs[SEND], "contentDigest"), undefined);
  assert.ok(!dataEdges.some((e) => refOf(e.source_node) === PREPARE && e.source_output === "contentDigest"));
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

test("the send step's call passes the five arguments and no other key, and the texts name the publish card as the one place the person decides", () => {
  assert.deepEqual(Object.keys(refs[SEND].data.input).sort(), ARGUMENTS);
  for (const name of ARGUMENTS) {
    const source = ARGUMENT_SOURCE[name] ?? name;
    assert.ok(refs[SEND].data.input[name].endsWith(`{{ ${source} }}`), `the send's call renders ${name} from another value`);
  }
  assert.ok(!JSON.stringify(refs[SEND].data).includes(PREVIEW_TOOL), "the send's call names the preview tool");
  const description = refs[SEND].metadata.cinatra.description;
  assert.ok(description.includes("publish card"), "the send step's description does not name the publish card");
  for (const text of [description, oas.description]) {
    assert.doesNotMatch(text, /confirmation gate|send-confirmation|at the gate/i, "a text names the confirmation gate the flow no longer has");
  }
});
