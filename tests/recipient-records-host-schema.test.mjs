// The declared module recipient-records.mjs against the rule the host applies to
// the recipient record: every record it saves must pass the schema of the email
// pack's own claim on @cinatra-ai/email:recipient, because the host refuses any
// other record of that type once the claim is active - cinatra-ai/cinatra#3089.
//
// The schema below is the claim's, copied verbatim from the email pack's manifest
// (package.json of cinatra-ai/email-artifacts at
// fe936a27b6aae6e4e985a1baf6e4747d7ea0a6d8, lines 290-309). It runs on the
// smallest rule set its text uses: a type, the length and the pattern of a
// string, the keys an object requires, the rules of the keys it names, and a
// list of alternatives of which one must hold. Its other keys add no rule.

import { test } from "node:test";
import assert from "node:assert/strict";

const { extensionTool } = await import(new URL("../cinatra/tools/recipient-records.mjs", import.meta.url));

const claimSchema = {
  "type": "object",
  "properties": {
    "runId": { "type": "string", "minLength": 1 },
    "connectorId": { "type": "string" },
    "contactKey": { "type": "string" },
    "email": { "type": "string", "minLength": 1, "pattern": "\\S" },
    "campaignId": { "type": "string" },
    "confirmed": { "type": "boolean" }
  },
  "required": [
    "runId"
  ],
  "anyOf": [
    { "required": ["email"] },
    { "required": ["contactKey"], "properties": { "contactKey": { "minLength": 1 } } }
  ],
  "x-cinatra-identity": ["runId", "contactKey"],
  "additionalProperties": true
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function accepts(schema, value) {
  if (schema.type === "object" && !isObject(value)) return false;
  if (schema.type === "string" && typeof value !== "string") return false;
  if (schema.type === "boolean" && typeof value !== "boolean") return false;
  if (typeof value === "string") {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) return false;
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) return false;
  }
  if (isObject(value)) {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) return false;
    for (const [key, inner] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key) && !accepts(inner, value[key])) return false;
    }
  }
  if (schema.anyOf !== undefined && !schema.anyOf.some((branch) => accepts(branch, value))) return false;
  return true;
}

class InvalidActivatedTypePayloadError extends Error {
  constructor(type) {
    super(`invalid payload for activated type '${type}'`);
    this.name = "InvalidActivatedTypePayloadError";
  }
}

// A port that saves as the host does with the type's claim active: the run
// marker becomes the run's id, then a record that fails the host's schema is
// refused before anything is kept.
function hostPorts(rows, events = [], schema = claimSchema) {
  const kept = [];
  const ports = {
    objects: {
      async read() {
        return { objectId: "list-1", type: "@cinatra-ai/campaigns:recipients", data: { confirmedRecipients: rows } };
      },
      async save({ type, data }) {
        const stored = {};
        for (const [key, value] of Object.entries(data)) {
          stored[key] = value && typeof value === "object" && value.boundRun === true ? "run-1" : value;
        }
        events.push(`save ${stored.contactKey}`);
        if (type !== "@cinatra-ai/email:recipient" || !accepts(schema, stored)) {
          throw new InvalidActivatedTypePayloadError(type);
        }
        kept.push(stored);
        return { objectId: `o-${kept.length}`, type, isNew: true };
      },
    },
  };
  return { ports, kept };
}

test("H1 the claim accepts a record keyed by the contact alone, and refuses one with neither an address nor a contact key", () => {
  assert.equal(accepts(claimSchema, { runId: "run-1", contactKey: "contact:c-2", confirmed: true }), true);
  assert.equal(accepts(claimSchema, { runId: "run-1", contactKey: "contact:c-2", email: "ben@example.org", confirmed: true }), true);
  assert.equal(accepts(claimSchema, { runId: "run-1", email: "ben@example.org" }), true);
  assert.equal(accepts(claimSchema, { runId: "run-1", confirmed: true }), false);
  assert.equal(accepts(claimSchema, { runId: "run-1", contactKey: "", confirmed: true }), false);
  assert.equal(accepts(claimSchema, { runId: "run-1", contactKey: "contact:c-2", email: "   ", confirmed: true }), false);
  assert.equal(accepts(claimSchema, { contactKey: "contact:c-2", confirmed: true }), false);
});

test("H2 a confirmed list that holds contacts without an address files each of them under the claim, keyed by the contact and without an address", async () => {
  const rows = [
    { contactId: "c-1", name: "Ann", title: "", email: "ann@example.org", accountId: "a-1", accountName: "Acme" },
    { contactId: "c-2", name: "Ben", title: "", email: "", accountId: "a-1", accountName: "Acme" },
    { contactId: "c-3", name: "Cy", title: "", email: "   ", accountId: "a-1", accountName: "Acme" },
    { contactId: "c-4", name: "Dee", title: "", email: "dee@example.org", accountId: "a-2", accountName: "Beta" },
  ];
  const { ports, kept } = hostPorts(rows);
  const answer = await extensionTool({ input: { recipientsRef: "list-1", campaignId: "camp-1" }, ports });
  assert.deepEqual(kept, [
    { runId: "run-1", contactKey: "contact:c-1", email: "ann@example.org", campaignId: "camp-1", confirmed: true },
    { runId: "run-1", contactKey: "contact:c-2", campaignId: "camp-1", confirmed: true },
    { runId: "run-1", contactKey: "contact:c-3", campaignId: "camp-1", confirmed: true },
    { runId: "run-1", contactKey: "contact:c-4", email: "dee@example.org", campaignId: "camp-1", confirmed: true },
  ]);
  assert.deepEqual(answer, { ok: true, filed: 4, skipped: 0 });
});

test("H3 every row is checked before the first record is saved", async () => {
  const events = [];
  const watched = (index, email) => ({
    contactId: `c-${index}`,
    get email() {
      events.push(`check ${index}`);
      return email;
    },
  });
  const { ports, kept } = hostPorts([watched(1, "ann@example.org"), watched(2, "ben@example.org"), watched(3, "cy@example.org")], events);
  await extensionTool({ input: { recipientsRef: "list-1" }, ports });
  assert.deepEqual(events, ["check 1", "check 2", "check 3", "save contact:c-1", "save contact:c-2", "save contact:c-3"]);
  assert.equal(kept.length, 3);
});

test("H4 a contact without an address is filed by its key under the claim, and a refused row fails the run visibly", async () => {
  const ann = { contactId: "c-1", name: "Ann", title: "", email: "ann@example.org", accountId: "a-1", accountName: "Acme" };
  const ben = { contactId: "c-2", name: "Ben", title: "", email: "", accountId: "a-1", accountName: "Acme" };

  // The contact without an address is filed, keyed by the run and the contact.
  const filed = hostPorts([ann, ben]);
  const answer = await extensionTool({ input: { recipientsRef: "list-1", campaignId: "camp-1" }, ports: filed.ports });
  assert.deepEqual(answer, { ok: true, filed: 2, skipped: 0 });
  assert.deepEqual(filed.kept[1], { runId: "run-1", contactKey: "contact:c-2", campaignId: "camp-1", confirmed: true });
  assert.equal(Object.hasOwn(filed.kept[1], "email"), false);

  // A row the claim refuses (no contact and no address) ends the call before any record is kept.
  const events = [];
  const refused = hostPorts([ann, ben, { name: "Nobody", email: "   " }], events);
  let caught;
  await extensionTool({ input: { recipientsRef: "list-1", campaignId: "camp-1" }, ports: refused.ports }).catch((e) => { caught = e; });
  assert.equal(caught?.name, "ExtensionToolCallRefusal");
  assert.match(caught.message, /\b3\b/);
  assert.deepEqual(events, []);
  assert.deepEqual(refused.kept, []);

  // A host whose rule still requires the address refuses the contact's record: that refusal reaches the caller unchanged.
  const strict = { ...claimSchema, required: [...claimSchema.required, "email"] };
  const host = hostPorts([ben, ann], [], strict);
  let refusal;
  await extensionTool({ input: { recipientsRef: "list-1" }, ports: host.ports }).catch((e) => { refusal = e; });
  assert.ok(refusal instanceof InvalidActivatedTypePayloadError);
  assert.deepEqual(host.kept, []);
});
