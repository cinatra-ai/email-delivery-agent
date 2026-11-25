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
//
// The card's values are bound to the send. Each approved body the step hands
// on carries the address and the subject of its draft as the step read them,
// the same address and subject the card's Recipients row shows for that draft.
// The send start compares, entry for entry, the contact, the address it
// resolves (outer white space removed, then exactly, the case included) and the
// subject it mails with the approved entry, and refuses the whole send before
// any mail on a difference. The copy below models that comparison too.

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

/** The contact key of a draft as the sender derives it: contactId, else recipientId, each trimmed first, a blank one absent. */
const senderContactOf = (item) => {
  for (const value of [item.contactId, item.recipientId]) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
};

/** A copy of the send start's reading: the address it hands on for each draft, with which contact, subject and body (before any override of the pipeline). */
function sendMails(bundle, list) {
  const recipients = list.data.confirmedRecipients ?? list.data.recipients ?? [];
  const drafts = bundle.data.drafts ?? bundle.data.confirmedRecipients ?? [];
  const mails = [];
  for (const draft of drafts) {
    const contact = senderContactOf(draft);
    let to = null;
    if (draft.recipientEmail) to = draft.recipientEmail;
    else if (draft.email) to = draft.email;
    else if (contact !== undefined) {
      const match = recipients.find((r) => senderContactOf(r) === contact);
      to = match?.email || match?.recipientEmail || null;
    }
    to = typeof to === "string" ? to.trim() : "";
    if (to === "") continue;
    mails.push({ to, contact, subject: draft.subject, body: draft.body ?? draft.bodyHtml ?? "" });
  }
  return mails;
}

/**
 * A copy of the send start's comparison of the approved bodies with what it mails: the list is compared with the
 * messages entry for entry, and each entry must name the contact, the address (outer white space removed, then
 * byte for byte) and the subject of its message. One difference refuses the whole send, before any mail.
 * Returns the refusal, or null when the send goes.
 */
function sendRefusal(mails, approvedBodies) {
  if (approvedBodies.length !== mails.length) return `${approvedBodies.length} approved bodies for ${mails.length} messages`;
  for (const [index, mail] of mails.entries()) {
    const entry = approvedBodies[index];
    if (entry.contactId !== mail.contact) return `the contact of message ${index + 1} differs`;
    if (String(entry.recipientEmail).trim() !== mail.to) return `the address of contact ${mail.contact} differs`;
    if (entry.subject !== mail.subject) return `the subject of contact ${mail.contact} differs`;
  }
  return null;
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
      { name: "Ada Lovelace", email: "ada@example.com", company: "Example One", subject: "One" },
      { name: "Ben Hill", email: "ben@example.com", company: "Example Two", subject: "Two" },
    ],
    emailBodies: [
      { ...BODIES[0], contactId: "c-1", recipientEmail: "ada@example.com", subject: "One" },
      { ...BODIES[1], contactId: "c-2", recipientEmail: "ben@example.com", subject: "Two" },
    ],
    callToAction: CALL_TO_ACTION,
  });
  const mails = sendMails(BUNDLE, LIST);
  assert.deepEqual(answer.recipients.map((r) => r.email), mails.map((m) => m.to), "the card lists the addresses the send start addresses, from the bundle and the list");
  const shown = answer.emailBodies.map((b) => TEXTS[b.artifactId].replace(/\s+$/, ""));
  assert.deepEqual(shown, mails.map((m) => m.body.replace(/\s+$/, "")), "the card shows the bodies the send mails");
  assert.deepEqual(answer.recipients.map((r) => r.subject), mails.map((m) => m.subject), "the card shows the subjects the send mails");
  assert.equal(sendRefusal(mails, answer.emailBodies), null, "the send refuses the bodies the card showed");
});

// ---- the address and the subject of each email ----

test("each approved body carries the address and the subject that the card's Recipients row shows for the same draft", async () => {
  const answer = await call(fullInput());
  assert.equal(answer.emailBodies.length, answer.recipients.length);
  answer.emailBodies.forEach((body, index) => {
    const line = answer.recipients[index];
    assert.equal(body.recipientEmail, line.email, `body ${index + 1}: the address differs from the card's line`);
    assert.equal(body.subject, line.subject, `body ${index + 1}: the subject differs from the card's line`);
    assert.deepEqual(Object.keys(body).sort(), ["artifactId", "contactId", "recipientEmail", "representationRevisionId", "subject"]);
  });
});

test("the address a draft takes from the recipient list is the one its approved body carries", async () => {
  // Ben's draft has no address of its own; the send takes the list's address for his contact.
  const answer = await call(fullInput());
  assert.equal(answer.emailBodies[1].recipientEmail, "ben@example.com");
  assert.equal(answer.recipients[1].email, "ben@example.com");
});

test("an address or a subject that changes after the card was shown refuses the send in the model of the send start", async () => {
  const answer = await call(fullInput());
  // The same address with outer space is the same address; the same letters in another case are not.
  const spaced = structuredClone(BUNDLE);
  spaced.data.drafts[0].recipientEmail = "  ada@example.com ";
  assert.equal(sendRefusal(sendMails(spaced, LIST), answer.emailBodies), null);
  for (const recasedAddress of ["ADA@example.com", "Ada@example.com", "ada@EXAMPLE.com", "  ada@Example.com "]) {
    const recased = structuredClone(BUNDLE);
    recased.data.drafts[0].recipientEmail = recasedAddress;
    assert.match(sendRefusal(sendMails(recased, LIST), answer.emailBodies), /address of contact c-1/, recasedAddress);
  }
  const readdressed = structuredClone(LIST);
  readdressed.data.confirmedRecipients[1].email = "someone-else@example.com";
  assert.match(sendRefusal(sendMails(BUNDLE, readdressed), answer.emailBodies), /address of contact c-2/);
  const resubjected = structuredClone(BUNDLE);
  resubjected.data.drafts[0].subject = "One, changed";
  assert.match(sendRefusal(sendMails(resubjected, LIST), answer.emailBodies), /subject of contact c-1/);
});

test("a mailed draft whose subject is missing or blank is refused before the card", async () => {
  for (const subject of [undefined, "", "   ", 7]) {
    const bundle = structuredClone(BUNDLE);
    if (subject === undefined) delete bundle.data.drafts[1].subject;
    else bundle.data.drafts[1].subject = subject;
    const message = await refusal(call(fullInput(), ports({ objects: { [LIST_REF]: LIST, [BUNDLE_REF]: bundle } })));
    assert.match(message, /^SUBJECT_MISSING: /);
    assert.match(message, /draft 2 /);
  }
});

test("a draft the send does not mail needs no subject", async () => {
  const bundle = structuredClone(BUNDLE);
  delete bundle.data.drafts[2].subject;
  const answer = await call(fullInput(), ports({ objects: { [LIST_REF]: LIST, [BUNDLE_REF]: bundle } }));
  assert.equal(answer.emailBodies.length, 2);
});

test("the subject is handed on as the draft holds it, which is the subject the send mails", async () => {
  const bundle = structuredClone(BUNDLE);
  bundle.data.drafts[0].subject = "  One  ";
  const answer = await call(fullInput(), ports({ objects: { [LIST_REF]: LIST, [BUNDLE_REF]: bundle } }));
  assert.equal(answer.emailBodies[0].subject, "  One  ");
  assert.equal(answer.recipients[0].subject, "  One  ");
  assert.equal(sendRefusal(sendMails(bundle, LIST), answer.emailBodies), null);
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

// ---- the address is the exact string a person approved ----

test("the card shows an address exactly as the draft writes it, outer white space removed, and the send takes no other case", async () => {
  const bundle = structuredClone(BUNDLE);
  bundle.data.drafts[0].recipientEmail = "  Ada.Lovelace@Example.COM ";
  const objects = { [LIST_REF]: LIST, [BUNDLE_REF]: bundle };
  const answer = await call(fullInput(), ports({ objects }));
  assert.equal(answer.recipients[0].email, "Ada.Lovelace@Example.COM");
  assert.equal(answer.emailBodies[0].recipientEmail, "Ada.Lovelace@Example.COM");
  assert.equal(sendRefusal(sendMails(bundle, LIST), answer.emailBodies), null, "the exact address is sent");
  for (const changed of ["ada.lovelace@example.com", "ada.lovelace@Example.COM", "Ada.Lovelace@example.com", "Ada.Lovelace@Example.COM.", "Ada.Lovelace@Example.CO"]) {
    const after = structuredClone(bundle);
    after.data.drafts[0].recipientEmail = changed;
    assert.match(sendRefusal(sendMails(after, LIST), answer.emailBodies), /address of contact c-1/, changed);
  }
});

test("a list row gives its name and company to a draft only for exactly the draft's address", async () => {
  const list = structuredClone(LIST);
  list.data.confirmedRecipients = [{ contactId: "c-other", name: "Row Name", email: "ada@example.com", company: "Row Company" }];
  const draftWith = (recipientEmail) => ({ contactId: "c-9", recipientEmail, subject: "S", body: ONE_TEXT });
  const bodies = JSON.stringify([{ artifactId: "a-1", representationRevisionId: "r-1", contactId: "c-9" }]);
  const run = (recipientEmail) =>
    call(fullInput(bodies), ports({ objects: { [LIST_REF]: list, [BUNDLE_REF]: { objectId: BUNDLE_REF, type: BUNDLE.type, data: { drafts: [draftWith(recipientEmail)] } } }, texts: { "a-1": ONE_TEXT } }));
  const same = await run(" ada@example.com ");
  assert.deepEqual([same.recipients[0].name, same.recipients[0].company], ["Row Name", "Row Company"]);
  const recased = await run("Ada@example.com");
  assert.deepEqual([recased.recipients[0].name, recased.recipients[0].company], ["", ""], "another case is another address, so no row is its row");
  assert.equal(recased.recipients[0].email, "Ada@example.com");
});

// ---- one rule for the contact key ----

/** The rule, written out: trim first, a blank is absent, then the fallback. */
const keyRule = (contactId, recipientId) => {
  const text = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
  return text(contactId) ?? text(recipientId);
};
const KEY_ROWS = [
  [" c-1 ", undefined],
  ["", "c-2"],
  ["   ", " c-3 "],
  [undefined, "c-4"],
  [null, " c-5"],
  ["c-6", "c-7"],
  [7, "c-8"],
  [undefined, undefined],
  ["  ", "  "],
  ["", ""],
];
const withKeys = (item, contactId, recipientId) => {
  const out = { ...item };
  if (contactId !== undefined) out.contactId = contactId;
  if (recipientId !== undefined) out.recipientId = recipientId;
  return out;
};
const oneList = (rows) => ({ objectId: LIST_REF, type: LIST.type, data: { confirmedRecipients: rows } });
const oneBundle = (draft) => ({ objectId: BUNDLE_REF, type: BUNDLE.type, data: { drafts: [draft] } });
const ONE_TEXT = "Hello.\n\nBook a call.";
const onePorts = (list, bundle) => ports({ objects: { [LIST_REF]: list, [BUNDLE_REF]: bundle }, texts: { "a-1": ONE_TEXT } });
const oneBody = JSON.stringify([{ artifactId: "a-1", representationRevisionId: "r-1" }]);
const recordsModule = await import(new URL("../cinatra/tools/recipient-records.mjs", import.meta.url));

test("every place that derives a contact key derives the same one from the same rows", async () => {
  for (const [contactId, recipientId] of KEY_ROWS) {
    const expected = keyRule(contactId, recipientId);
    const label = JSON.stringify([contactId, recipientId]);

    // The read step, for a draft that has its own address.
    const draft = withKeys({ subject: "S", body: ONE_TEXT, recipientEmail: "x@example.com" }, contactId, recipientId);
    const own = call(fullInput(oneBody, "Book a call."), onePorts(oneList([]), oneBundle(draft)));
    if (expected === undefined) assert.match(await refusal(own), /names no contact/, label);
    else assert.equal((await own).emailBodies[0].contactId, expected, label);

    // The sender's derivation (the copy of it in this file).
    assert.equal(senderContactOf(withKeys({}, contactId, recipientId)), expected, label);
    if (expected !== undefined) assert.equal(sendMails(oneBundle(draft), oneList([]))[0].contact, expected, label);

    // The read step, for the address a draft without one takes from the list row of its contact.
    if (expected !== undefined) {
      const row = withKeys({ email: "row@example.com", name: "Row" }, contactId, recipientId);
      const decoy = { contactId: "someone-else", email: "decoy@example.com" };
      const bare = { subject: "S", body: ONE_TEXT, contactId: expected };
      const answer = await call(fullInput(oneBody, "Book a call."), onePorts(oneList([decoy, row]), oneBundle(bare)));
      assert.equal(answer.recipients[0].email, "row@example.com", label);
      assert.equal(sendMails(oneBundle(bare), oneList([decoy, row]))[0].to, "row@example.com", label);
    }

    // The filing step, for a row with an address.
    const saved = [];
    const filingPorts = {
      objects: {
        read: async () => oneList([withKeys({ email: "r@example.com" }, contactId, recipientId)]),
        save: async ({ data }) => saved.push(data),
      },
    };
    await recordsModule.extensionTool({ input: { recipientsRef: "list" }, ports: filingPorts });
    assert.equal(saved[0].contactKey, expected === undefined ? "email:r@example.com" : `contact:${expected}`, label);
  }
});

test("a draft with a blank contactId and a valid recipientId reaches the card with its recipientId and the send finds its approved body", async () => {
  for (const blank of ["", "   "]) {
    const bundle = structuredClone(BUNDLE);
    bundle.data.drafts[0].contactId = blank;
    const objects = { [LIST_REF]: LIST, [BUNDLE_REF]: bundle };
    for (const bodies of [BODIES, BODIES.map((b, i) => ({ ...b, contactId: ["c-1", "c-2", "c-3"][i] }))]) {
      const answer = await call(fullInput(JSON.stringify(bodies)), ports({ objects }));
      assert.equal(answer.emailBodies[0].contactId, "c-1");
      assert.equal(sendMails(bundle, LIST)[0].contact, "c-1");
      assert.equal(sendRefusal(sendMails(bundle, LIST), answer.emailBodies), null, `blank ${JSON.stringify(blank)}`);
    }
  }
});

test("the filing step and the read step declare the contact key function with one text", () => {
  const sourceOf = (file) => readFileSync(join(root, "cinatra", "tools", file), "utf8");
  const textOf = (file) => {
    const found = [...sourceOf(file).matchAll(/^const contactKeyOf = .*;$/gm)];
    assert.equal(found.length, 1, `${file} declares the function once`);
    return found[0][0];
  };
  assert.equal(textOf("recipient-records.mjs"), textOf("send-contents.mjs"));
  for (const file of ["recipient-records.mjs", "send-contents.mjs"]) {
    const found = sourceOf(file).match(/trimmedOrNone\((?:draft|row|item)\.contactId\)/g) ?? [];
    assert.equal(found.length, 1, `${file} derives a contact key in one place only`);
  }
});
