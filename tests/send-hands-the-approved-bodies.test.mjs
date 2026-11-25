// The send mails the approved body revisions the publish card showed -
// cinatra-ai/cinatra#3089.
//
// The send start takes `approvedBodies`: one `{ artifactId,
// representationRevisionId, contactId, recipientEmail, subject }` per mailed
// draft, where `contactId` is the draft's `contactId`, else its `recipientId`,
// and `recipientEmail` and `subject` are the address and the subject the card
// showed for that draft (cinatra
// src/lib/trigger-email-send-use-cases.ts, runInitialSend, the approved form;
// packages/trigger-email-send/src/mcp/schemas.ts). It mails the text of each
// draft's approved revision and refuses the whole send when a mailed draft has
// no body, a body names no draft or a draft named twice, or one artifact or
// one contact occurs twice.
//
// The read step in front of the send joins each body to its draft exactly:
// by the contact a body names, or, when the bodies name no contact, by its
// position among ALL drafts of the bundle (the drafting pack files one body
// per draft, in draft order). It refuses the run before the card when a body
// cannot be joined to exactly one draft, when a mailed draft has no body, or
// when a contact occurs twice. The card's Emails row and the send's
// `approvedBodies` are the one output of that step, through one input of the
// send step.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const refs = oas.$referenced_components ?? {};
const { extensionTool } = await import(new URL("../cinatra/tools/send-contents.mjs", import.meta.url));

const BUNDLE_REF = "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a6b";
const LIST_REF = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const BODY_TYPE = "@cinatra-ai/email:body";

const LIST = {
  objectId: LIST_REF,
  type: "@cinatra-ai/campaigns:recipients",
  data: {
    confirmedRecipients: [
      { contactId: "c-1", name: "Ada Lovelace", email: "ada@example.com", company: "Example One" },
      { contactId: "c-2", name: "Ben Hill", email: "ben@example.com", company: "Example Two" },
      { contactId: "c-3", name: "Cy Noaddress", company: "Example Three" },
    ],
  },
};
// The draft without an address sits between the two mailed drafts.
const DRAFTS = [
  { recipientId: "c-1", recipientName: "Ada Lovelace", recipientEmail: "ada@example.com", subject: "One", body: "Hello Ada. Book a call." },
  { recipientId: "c-3", recipientName: "Cy Noaddress", recipientEmail: "", subject: "Three", body: "Hello Cy. Book a call." },
  { contactId: "c-2", subject: "Two", body: "Hello Ben. Book a call." },
];
const bundleOf = (drafts) => ({ objectId: BUNDLE_REF, type: "@cinatra-ai/campaigns:email-draft-bundle", data: { drafts } });
const TEXTS = { "a-1": "Hello Ada. Book a call.", "a-3": "Hello Cy. Book a call.", "a-2": "Hello Ben. Book a call." };
const POSITIONAL = [
  { artifactId: "a-1", representationRevisionId: "r-1" },
  { artifactId: "a-3", representationRevisionId: "r-3" },
  { artifactId: "a-2", representationRevisionId: "r-2" },
];
const withContact = (body, contactId) => ({ ...body, contactId });

function ports({ drafts = DRAFTS, texts = TEXTS } = {}) {
  const objects = { [LIST_REF]: LIST, [BUNDLE_REF]: bundleOf(drafts) };
  return {
    objects: {
      async read({ objectId }) {
        if (!objects[objectId]) throw new Error("not an object of this run");
        return structuredClone(objects[objectId]);
      },
    },
    artifacts: {
      async contentRead({ artifactId, representationRevisionId }) {
        if (!(artifactId in texts)) throw new Error("not an artifact this run's organisation can see");
        return { artifactId, representationRevisionId, objectType: BODY_TYPE, text: texts[artifactId], truncated: false };
      },
    },
  };
}

const call = (bodies, p = ports()) =>
  extensionTool({ input: { recipientsRef: LIST_REF, draftBundleRef: BUNDLE_REF, emailBodies: JSON.stringify(bodies), callToAction: "Book a call." }, ports: p });

async function refusal(promise, pattern) {
  const error = await promise.then(
    () => assert.fail("the call was not refused"),
    (e) => e,
  );
  assert.equal(error.name, "ExtensionToolCallRefusal");
  if (pattern) assert.match(error.message, pattern);
  return error.message;
}

const EXPECTED_BODIES = [
  { artifactId: "a-1", representationRevisionId: "r-1", contactId: "c-1", recipientEmail: "ada@example.com", subject: "One" },
  { artifactId: "a-2", representationRevisionId: "r-2", contactId: "c-2", recipientEmail: "ben@example.com", subject: "Two" },
];

test("each mailed draft gets one body entry with its draft's contact; the draft without an address gets none and shifts nothing", async () => {
  const answer = await call(POSITIONAL);
  assert.deepEqual(answer.emailBodies, EXPECTED_BODIES);
  assert.deepEqual(answer.recipients.map((r) => r.email), ["ada@example.com", "ben@example.com"]);
});

test("bodies that name their contact are joined by the contact, in any order, and need no body for a draft without an address", async () => {
  const shuffled = [withContact(POSITIONAL[2], "c-2"), withContact(POSITIONAL[0], "c-1")];
  assert.deepEqual((await call(shuffled)).emailBodies, EXPECTED_BODIES);
  const all = [withContact(POSITIONAL[1], "c-3"), ...shuffled];
  assert.deepEqual((await call(all)).emailBodies, EXPECTED_BODIES);
});

test("a body joined to the wrong draft by its contact is refused by the text check", async () => {
  await refusal(call([withContact(POSITIONAL[0], "c-2"), withContact(POSITIONAL[2], "c-1")]), /not the body of approved draft/);
});

test("a body whose contact names no draft is refused before the card", async () => {
  await refusal(call([withContact(POSITIONAL[0], "c-1"), withContact(POSITIONAL[2], "c-2"), withContact(POSITIONAL[1], "c-9")]), /c-9/);
});

test("two bodies for one contact are refused before the card", async () => {
  await refusal(
    call([withContact(POSITIONAL[0], "c-1"), withContact(POSITIONAL[2], "c-2"), withContact({ artifactId: "a-4", representationRevisionId: "r-4" }, "c-2")], ports({ texts: { ...TEXTS, "a-4": "Hello Ben. Book a call." } })),
    /both for contact c-2/,
  );
});

test("one artifact named twice is refused before the card", async () => {
  await refusal(call([withContact(POSITIONAL[0], "c-1"), withContact(POSITIONAL[0], "c-2")]), /a second time/);
  await refusal(call([POSITIONAL[0], POSITIONAL[0], POSITIONAL[2]]), /a second time/);
});

test("a mailed draft without a body is refused before the card", async () => {
  await refusal(call([withContact(POSITIONAL[0], "c-1")]), /draft 3 .*no approved body|has an address but no/);
  // Positional bodies for the mailed drafts only do not line up with the drafts, so they are refused.
  await refusal(call([POSITIONAL[0], POSITIONAL[2]]));
});

test("two drafts for one contact are refused before the card", async () => {
  const drafts = [DRAFTS[0], { ...DRAFTS[2], contactId: "c-1", recipientEmail: "ben@example.com" }];
  await refusal(call([POSITIONAL[0], POSITIONAL[2]], ports({ drafts })), /one contact c-1|contact c-1/);
});

test("a mailed draft that names no contact is refused before the card: the send cannot join a body to it", async () => {
  const drafts = [DRAFTS[0], { recipientEmail: "ben@example.com", subject: "Two", body: "Hello Ben. Book a call." }];
  await refusal(call([POSITIONAL[0], POSITIONAL[2]], ports({ drafts })), /names no contact/);
});

test("bodies that name a contact mixed with bodies that do not are refused before the card", async () => {
  await refusal(call([withContact(POSITIONAL[0], "c-1"), POSITIONAL[1], POSITIONAL[2]]), /some .*contact/i);
});

test("more mailed drafts than one send takes are refused before the card", async () => {
  const drafts = [];
  const texts = {};
  const bodies = [];
  for (let i = 1; i <= 51; i += 1) {
    drafts.push({ recipientId: `k-${i}`, recipientEmail: `p${i}@example.com`, subject: "S", body: `Body ${i}. Book a call.` });
    texts[`b-${i}`] = `Body ${i}. Book a call.`;
    bodies.push({ artifactId: `b-${i}`, representationRevisionId: `v-${i}` });
  }
  await refusal(call(bodies, ports({ drafts, texts })), /50/);
});

// ---- the flow ----

const refOf = (node) => node?.$component_ref;
const dataEdges = oas.data_flow_connections ?? [];
const inputOf = (owner, title) => (owner.inputs ?? []).find((entry) => entry.title === title);
function sourceOf(step, input) {
  const into = dataEdges.filter((e) => refOf(e.destination_node) === step && e.destination_input === input);
  assert.equal(into.length, 1, `${step}.${input} is fed by ${into.length} data-flow edges, not one`);
  return `${refOf(into[0].source_node)}.${into[0].source_output}`;
}

test("the send call carries approvedBodies from the one input the card's Emails row shows, and no contentDigest", () => {
  const send = refs.send;
  assert.deepEqual(Object.keys(send.data.input).sort(), ["approvedBodies", "approvedDraftBundleRef", "campaignId", "confirmedRecipientsRef", "senderEmail"]);
  assert.ok(!JSON.stringify(send.data).includes("contentDigest"), "the send call still names the digest");
  assert.equal(inputOf(send, "contentDigest"), undefined, "the send step still takes the digest");
  assert.equal(dataEdges.filter((e) => refOf(e.destination_node) === "send" && e.destination_input === "contentDigest").length, 0);
  // The value the send passes as approvedBodies is the input the Emails row shows, as JSON text: the passthrough
  // road hands a template value on as a string, and the send start reads a list from it.
  const emails = send.metadata.cinatra.publishRows.find((row) => row.label === "Emails");
  assert.equal(emails.kind, "artifacts");
  assert.ok(send.data.input.approvedBodies.endsWith(`{{ ${emails.input} | tojson }}`), "the send call does not render approvedBodies from the Emails row's input");
  // That input is the read step's output, and the read step runs right before the send.
  assert.equal(sourceOf("send", emails.input), "resolve_send.emailBodies");
  const into = (oas.control_flow_connections ?? []).filter((e) => refOf(e.to_node) === "send").map((e) => refOf(e.from_node));
  assert.deepEqual(into, ["resolve_send"], "a run reaches the send other than through the read step");
});

// An empty list never reaches the send: the send step is reached only from the
// read step and takes its bodies only from it, and the read step refuses (the
// passthrough road answers a refusal with an error, which ends the run) every
// run whose list would be empty. A list it hands on holds one body per mailed
// draft, so it is never empty.
test("a run whose list of bodies would be empty ends at the read step, so the send never takes an empty list", async () => {
  await refusal(call([]), /./);
  await refusal(
    extensionTool({ input: { recipientsRef: LIST_REF, draftBundleRef: BUNDLE_REF, callToAction: "Book a call." }, ports: ports() }),
    /./,
  );
  await refusal(call(POSITIONAL, ports({ drafts: [] })), /nothing to send/);
  const noAddress = DRAFTS.map((draft) => ({ ...draft, recipientEmail: "" })).map(({ contactId, ...rest }) => ({ ...rest, recipientId: rest.recipientId ?? contactId }));
  const unaddressed = { ...LIST, data: { confirmedRecipients: LIST.data.confirmedRecipients.map(({ email, ...rest }) => rest) } };
  const p = ports({ drafts: noAddress });
  p.objects.read = async ({ objectId }) => structuredClone(objectId === LIST_REF ? unaddressed : bundleOf(noAddress));
  await refusal(call(POSITIONAL, p), /mail nothing|address/);
  const answer = await call(POSITIONAL);
  assert.ok(answer.emailBodies.length >= 1);
  assert.equal(answer.emailBodies.length, answer.recipients.length);
  assert.equal(Object.hasOwn(inputOf(refs.send, "emailBodies"), "default"), false, "the send step can start without the read step's list");
});

test("the read step's bodies and the send's bodies carry the contact the send start joins on, and the address and subject it compares", () => {
  const output = (refs.resolve_send.outputs ?? []).find((entry) => entry.title === "emailBodies");
  const input = inputOf(refs.send, "emailBodies");
  for (const entry of [output, input]) {
    assert.deepEqual(entry.json_schema.items.required, ["artifactId", "representationRevisionId", "contactId", "recipientEmail", "subject"]);
    assert.deepEqual(Object.keys(entry.json_schema.items.properties), ["artifactId", "representationRevisionId", "contactId", "recipientEmail", "subject"]);
    assert.equal(entry.json_schema.maxItems, 50);
  }
  // The bodies the run hands in may name their contact.
  for (const owner of [oas, refs.start, refs.resolve_send]) {
    const items = inputOf(owner, "emailBodies").json_schema.items;
    assert.deepEqual(Object.keys(items.properties), ["artifactId", "representationRevisionId", "contactId"]);
    assert.deepEqual(items.required, ["artifactId", "representationRevisionId"]);
  }
});
