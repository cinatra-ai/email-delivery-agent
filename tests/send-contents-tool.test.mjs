// The read step's module shows what the send mails - cinatra-ai/cinatra#3089.
//
// The module reads the two references the send start reads (the approved draft
// bundle and the confirmed recipient list) and gives the publish card the
// recipients the send mails and the body revisions of the drafts it mails. The
// arms run the module over stand-in ports and compare its answer with a copy of
// the send start's own reading of the same two objects (cinatra
// src/lib/trigger-email-send-use-cases.ts at c35e539a6, runInitialSend: the
// drafts under `drafts`, the address from recipientEmailFor, the body as
// `draft.body ?? draft.bodyHtml ?? ""`, a draft without an address not mailed).
//
// What these arms prove about the recipients: the card lists the addresses the
// send start hands to the email pipeline for the drafts of the bundle and the
// list. They do not prove whom the pipeline finally mails. When the workspace's
// development-mode recipient override is on, the pipeline replaces every
// address with the configured override address (and empties cc and bcc); no
// port of this module can read that setting, so the copy below models the send
// start only, up to the address it hands on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const MODULE_PATH = "./cinatra/tools/send-contents.mjs";
const { extensionTool } = await import(new URL(`../${MODULE_PATH.slice(2)}`, import.meta.url));

const BUNDLE_REF = "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a6b";
const LIST_REF = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const BODY_TYPE = "@cinatra-ai/email:body";

const LIST = {
  objectId: LIST_REF,
  type: "@cinatra-ai/campaigns:recipients",
  data: {
    confirmedRecipients: [
      { contactId: "c-1", name: "Ada Lovelace", email: "ada@example.com", company: "Example One" },
      { contactId: "c-2", firstName: "Ben", lastName: "Hill", email: "ben@example.com", companyName: "Example Two" },
      { contactId: "c-3", name: "Cy Noaddress", company: "Example Three" },
    ],
  },
};
const BUNDLE = {
  objectId: BUNDLE_REF,
  type: "@cinatra-ai/campaigns:email-draft-bundle",
  data: {
    drafts: [
      { recipientId: "c-1", recipientName: "Ada Lovelace", recipientEmail: "ada@example.com", subject: "One", body: "Hello Ada,\n\nOne idea. Book a call." },
      { contactId: "c-2", subject: "Two", body: "Hello Ben,\n\nAnother idea. Book a call." },
      { recipientId: "c-3", recipientName: "Cy Noaddress", recipientEmail: "", subject: "Three", body: "Hello Cy." },
    ],
  },
};
const BODIES = [
  { artifactId: "a-1", representationRevisionId: "r-1" },
  { artifactId: "a-2", representationRevisionId: "r-2" },
  { artifactId: "a-3", representationRevisionId: "r-3" },
];
// The draft without an address (c-3) does not carry the call to action: the send does not mail it.
const CALL_TO_ACTION = "Book a call.";
const TEXTS = { "a-1": "Hello Ada,\n\nOne idea. Book a call.\n", "a-2": "Hello Ben,\n\nAnother idea. Book a call.", "a-3": "Hello Cy." };

function ports({ objects = { [LIST_REF]: LIST, [BUNDLE_REF]: BUNDLE }, texts = TEXTS, type = BODY_TYPE, truncated = false } = {}) {
  const reads = [];
  return {
    reads,
    objects: {
      async read({ objectId }) {
        reads.push(objectId);
        const found = objects[objectId];
        if (!found) throw new Error("not an object of this run");
        return structuredClone(found);
      },
      async save() {
        throw new Error("the read step saved a record");
      },
    },
    artifacts: {
      async contentRead({ artifactId, representationRevisionId, objectType }) {
        assert.equal(objectType, BODY_TYPE, "the read names the body type it expects");
        if (!(artifactId in texts)) throw new Error("not an artifact this run's organisation can see");
        return { artifactId, representationRevisionId, objectType: type, mime: "text/markdown", text: texts[artifactId], truncated };
      },
      async list() {
        throw new Error("the read step listed artifacts");
      },
    },
  };
}

const call = (input, p = ports()) => extensionTool({ input, ports: p });
const fullInput = (emailBodies = JSON.stringify(BODIES), callToAction = CALL_TO_ACTION) => ({ recipientsRef: LIST_REF, draftBundleRef: BUNDLE_REF, emailBodies, callToAction });

/** A copy of the send start's reading: the address it hands on for each draft, with which body (before any override of the pipeline). */
function sendMails(bundle, list) {
  const recipients = list.data.confirmedRecipients ?? list.data.recipients ?? [];
  const drafts = bundle.data.drafts ?? bundle.data.confirmedRecipients ?? [];
  const mails = [];
  for (const draft of drafts) {
    let to = null;
    if (draft.recipientEmail) to = draft.recipientEmail;
    else if (draft.email) to = draft.email;
    else if (draft.contactId) {
      const match = recipients.find((r) => r.contactId === draft.contactId);
      to = match?.email || match?.recipientEmail || null;
    }
    if (!to) continue;
    mails.push({ to, body: draft.body ?? draft.bodyHtml ?? "" });
  }
  return mails;
}

async function refusal(promise) {
  const error = await promise.then(
    () => assert.fail("the call was not refused"),
    (e) => e,
  );
  assert.equal(error.name, "ExtensionToolCallRefusal");
  return error.message;
}

test("the manifest declares send_contents once, at the shipped module, as embeddable", async () => {
  const entries = pkg.cinatra.tools.filter((t) => t.name === "send_contents");
  assert.deepEqual(entries, [{ name: "send_contents", module: MODULE_PATH, embeddable: true }]);
  assert.ok(existsSync(join(root, MODULE_PATH)));
  assert.equal(typeof extensionTool, "function");
  assert.equal(extensionTool.length, 1);
});

test("the card's recipients and bodies are exactly the drafts the send mails, from the same two references", async () => {
  const p = ports();
  const answer = await call(fullInput(), p);
  assert.deepEqual(p.reads.sort(), [BUNDLE_REF, LIST_REF].sort(), "the step reads the two references the send start reads");
  assert.deepEqual(answer, {
    recipients: [
      { name: "Ada Lovelace", email: "ada@example.com", company: "Example One" },
      { name: "Ben Hill", email: "ben@example.com", company: "Example Two" },
    ],
    emailBodies: [
      { ...BODIES[0], contactId: "c-1" },
      { ...BODIES[1], contactId: "c-2" },
    ],
    callToAction: CALL_TO_ACTION,
  });
  const mails = sendMails(BUNDLE, LIST);
  assert.deepEqual(answer.recipients.map((r) => r.email), mails.map((m) => m.to), "the card lists the addresses the send start addresses, from the bundle and the list");
  const shown = answer.emailBodies.map((b) => TEXTS[b.artifactId].replace(/\s+$/, ""));
  assert.deepEqual(shown, mails.map((m) => m.body.replace(/\s+$/, "")), "the card shows the bodies the send mails");
});

test("a list already parsed is taken as it is", async () => {
  const answer = await call(fullInput(structuredClone(BODIES)));
  assert.equal(answer.emailBodies.length, 2);
});

test("a run without email bodies, or with a body short, is refused before the card", async () => {
  await refusal(call({ recipientsRef: LIST_REF, draftBundleRef: BUNDLE_REF, callToAction: CALL_TO_ACTION }));
  for (const bodies of [null, "", "[]", "not json", JSON.stringify(BODIES.slice(0, 2)), JSON.stringify({ a: 1 })]) {
    await refusal(call(fullInput(bodies)));
  }
  await refusal(call(fullInput(JSON.stringify([BODIES[0], { artifactId: "a-2" }, BODIES[2]]))));
});

test("a run without either reference is refused before any read", async () => {
  for (const input of [{ draftBundleRef: BUNDLE_REF, emailBodies: "[]" }, { recipientsRef: LIST_REF, emailBodies: "[]" }, { recipientsRef: " ", draftBundleRef: BUNDLE_REF }]) {
    const p = ports();
    await refusal(call(input, p));
    assert.deepEqual(p.reads, []);
  }
});

test("a body revision that is not the body of its draft is refused, so the card never shows an email the send would not mail", async () => {
  const message = await refusal(call(fullInput(), ports({ texts: { ...TEXTS, "a-2": "Hello Ben,\n\nAn older idea. Book a call." } })));
  assert.match(message, /Email body 2 /);
  // Bodies handed in out of draft order are refused too.
  await refusal(call(fullInput(JSON.stringify([BODIES[1], BODIES[0], BODIES[2]]))));
});

test("a revision of another type, or one that is cut, is refused", async () => {
  await refusal(call(fullInput(), ports({ type: "@cinatra-ai/blog-post-artifact:post" })));
  await refusal(call(fullInput(), ports({ truncated: true })));
});

test("references that are not a draft bundle and a recipient list are refused", async () => {
  await refusal(call(fullInput(), ports({ objects: { [LIST_REF]: LIST, [BUNDLE_REF]: { ...BUNDLE, type: "@cinatra-ai/other:thing" } } })));
  await refusal(call(fullInput(), ports({ objects: { [LIST_REF]: { ...LIST, type: "@cinatra-ai/other:thing" }, [BUNDLE_REF]: BUNDLE } })));
  await refusal(call(fullInput("[]"), ports({ objects: { [LIST_REF]: LIST, [BUNDLE_REF]: { ...BUNDLE, data: { drafts: [] } } } })));
});

test("a bundle whose drafts have no address is refused: the send would mail nothing", async () => {
  const bundle = { ...BUNDLE, data: { drafts: [BUNDLE.data.drafts[2]] } };
  await refusal(call(fullInput(JSON.stringify([BODIES[2]])), ports({ objects: { [LIST_REF]: LIST, [BUNDLE_REF]: bundle } })));
});

// ---- the call to action ----
//
// The card's "Call to action" row shows the call to action this step hands on,
// and this step hands on only a call to action that every email the send mails
// carries in its text. The text is compared as the bodies are compared with
// their drafts: trailing white space is not part of it.

test("the call to action is handed on only when every mailed body carries it", async () => {
  const answer = await call(fullInput(undefined, `  ${CALL_TO_ACTION}  `));
  assert.equal(answer.callToAction, CALL_TO_ACTION);
  for (const body of answer.emailBodies) assert.ok(TEXTS[body.artifactId].includes(answer.callToAction), body.artifactId);
});

test("a call to action that a mailed body does not carry stops the run before the card", async () => {
  const bundle = structuredClone(BUNDLE);
  bundle.data.drafts[1].body = "Hello Ben,\n\nAnother idea. Reply to this email.";
  const p = ports({ objects: { [LIST_REF]: LIST, [BUNDLE_REF]: bundle }, texts: { ...TEXTS, "a-2": "Hello Ben,\n\nAnother idea. Reply to this email." } });
  const message = await refusal(call(fullInput(), p));
  assert.match(message, /^CALL_TO_ACTION_NOT_IN_EMAIL: /);
  assert.match(message, /email body 2 /i);
  assert.ok(!message.includes(CALL_TO_ACTION), "the refusal repeats the call to action");
  // A call to action that no mailed body carries is refused too.
  await refusal(call(fullInput(undefined, "Visit our booth.")));
});

test("a run without a call to action is refused before the card", async () => {
  const { callToAction: _left, ...without } = fullInput();
  for (const input of [without, ...["", "   ", 42].map((callToAction) => ({ ...without, callToAction }))]) {
    const message = await refusal(call(input));
    assert.match(message, /^CALL_TO_ACTION_MISSING: /);
  }
});

test("a body that is not mailed need not carry the call to action", async () => {
  assert.ok(!TEXTS["a-3"].includes(CALL_TO_ACTION));
  assert.equal((await call(fullInput())).callToAction, CALL_TO_ACTION);
});
