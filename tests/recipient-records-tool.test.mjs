// The declared module recipient-records.mjs: one recipient record per confirmed
// recipient that has an address, keyed as the application keys it; a recipient
// without an address is skipped and counted - cinatra-ai/cinatra#3089.

import { test } from "node:test";
import assert from "node:assert/strict";

const { extensionTool } = await import(new URL("../cinatra/tools/recipient-records.mjs", import.meta.url));

const RECIPIENT = "@cinatra-ai/email:recipient";
const LIST = "@cinatra-ai/campaigns:recipients";
const BOUND = { boundRun: true };
const FORBIDDEN = ["externalId", "external_id", "cinatraAgentRunId", "agent_run_id", "cinatra_agent_run_id", "cinatra_run_id"];

const everySave = [];
const everyOtherPort = [];

function makePorts({ list, readError, saveError, failOnSave }) {
  const calls = { reads: [], saves: [] };
  const other = (name) =>
    new Proxy({}, {
      get(_t, prop) {
        everyOtherPort.push(`${name}.${String(prop)}`);
        throw new Error(`port ${name} must not be used`);
      },
    });
  const ports = {
    objects: {
      async read(arg) {
        calls.reads.push(arg);
        if (readError) throw readError;
        return list;
      },
      async save(arg) {
        calls.saves.push(arg);
        everySave.push(arg);
        if (saveError && calls.saves.length === (failOnSave ?? 1)) throw saveError;
        return { objectId: `o-${calls.saves.length}` };
      },
    },
    data: other("data"),
    artifacts: other("artifacts"),
    review: other("review"),
    clock: other("clock"),
  };
  return { ports, calls };
}

const listOf = (data, type = LIST) => ({ objectId: "list-1", type, data });

class Row {
  constructor(contactId) {
    this.contactId = contactId;
  }
}

function assertRefusal(error) {
  assert.equal(error.name, "ExtensionToolCallRefusal");
  assert.equal(typeof error.message, "string");
  assert.ok(error.message.length > 0 && error.message.length <= 400);
  assert.ok(!/[\r\n]/.test(error.message));
  return true;
}

const R1_ROWS = [
  { contactId: " c-1 ", email: " Ann@Example.org ", name: "Ann" },
  { contactId: "c-2", name: "Ben" },
  { email: "Cy@Example.org" },
  { recipientEmail: "dee@example.org" },
  { name: "Nobody" },
  { contactId: "c-1", email: "other@example.org" },
  "not-an-object",
];

test("R1 one record per confirmed recipient with an address, the application's key; a recipient without an address is skipped", async () => {
  const { ports, calls } = makePorts({ list: listOf({ confirmedRecipients: R1_ROWS }) });
  const answer = await extensionTool({ input: { recipientsRef: " list-1 ", campaignId: "camp-1" }, ports });
  assert.deepEqual(calls.reads, [{ objectId: "list-1" }]);
  assert.deepEqual(calls.saves, [
    { type: RECIPIENT, data: { runId: BOUND, contactKey: "contact:c-1", email: "Ann@Example.org", campaignId: "camp-1", confirmed: true } },
    { type: RECIPIENT, data: { runId: BOUND, contactKey: "email:cy@example.org", email: "Cy@Example.org", campaignId: "camp-1", confirmed: true } },
    { type: RECIPIENT, data: { runId: BOUND, contactKey: "email:dee@example.org", email: "dee@example.org", campaignId: "camp-1", confirmed: true } },
  ]);
  assert.ok(calls.saves.every((save) => typeof save.data.email === "string" && save.data.email.trim() !== ""));
  assert.deepEqual(answer, { ok: true, filed: 3, skipped: 4, skippedWithoutAddress: 2 });
  await whitespaceCases();
});

async function whitespaceCases() {
  const bare = Object.assign(Object.create(null), { contactId: "c-bare" });
  const { ports, calls } = makePorts({
    list: listOf({
      confirmedRecipients: [
        { contactId: "c-9", email: "   " },
        { contactId: "  ", email: "Zed@Example.org" },
        new Row("c-class"),
        new Date(0),
        new Map([["contactId", "c-map"]]),
        bare,
      ],
    }),
  });
  const answer = await extensionTool({ input: { recipientsRef: "list-1" }, ports });
  assert.equal(calls.saves[0].data.contactKey, "email:zed@example.org");
  assert.equal(calls.saves[0].data.email, "Zed@Example.org");
  assert.deepEqual(calls.saves.map((s) => s.data.contactKey), ["email:zed@example.org"]);
  assert.deepEqual(answer, { ok: true, filed: 1, skipped: 5, skippedWithoutAddress: 2 });
}

test("R2 the recipients array is used alone; confirmedRecipients wins when both exist", async () => {
  const only = makePorts({ list: listOf({ recipients: [{ contactId: "r-1", email: "r1@example.org" }, { contactId: "r-2", email: "r2@example.org" }] }) });
  const a = await extensionTool({ input: { recipientsRef: "list-1" }, ports: only.ports });
  assert.deepEqual(only.calls.saves.map((s) => s.data.contactKey), ["contact:r-1", "contact:r-2"]);
  assert.deepEqual(a, { ok: true, filed: 2, skipped: 0, skippedWithoutAddress: 0 });

  const both = makePorts({ list: listOf({ confirmedRecipients: [{ contactId: "w-1", email: "w1@example.org" }], recipients: [{ contactId: "l-1", email: "l1@example.org" }, { contactId: "l-2", email: "l2@example.org" }] }) });
  await extensionTool({ input: { recipientsRef: "list-1" }, ports: both.ports });
  assert.deepEqual(both.calls.saves.map((s) => s.data.contactKey), ["contact:w-1"]);
});

test("R3 a rejected save reaches the caller unchanged and no later row is saved", async () => {
  const failure = new Error("save refused");
  const { ports, calls } = makePorts({
    list: listOf({ confirmedRecipients: [{ contactId: "a", email: "a@example.org" }, { contactId: "b", email: "b@example.org" }, { contactId: "c", email: "c@example.org" }] }),
    saveError: failure,
    failOnSave: 2,
  });
  let caught;
  await extensionTool({ input: { recipientsRef: "list-1" }, ports }).catch((e) => { caught = e; });
  assert.strictEqual(caught, failure);
  assert.equal(calls.saves.length, 2);
});

test("R4 a rejected read reaches the caller unchanged and nothing is saved", async () => {
  const failure = { name: "SomeRefusal", message: "read refused" };
  const { ports, calls } = makePorts({ readError: failure });
  let caught;
  await extensionTool({ input: { recipientsRef: "list-1" }, ports }).catch((e) => { caught = e; });
  assert.strictEqual(caught, failure);
  assert.equal(calls.saves.length, 0);
});

test("R5 a missing, a non-string and a blank recipientsRef are refused before any read", async () => {
  for (const input of [{}, { recipientsRef: 7 }, { recipientsRef: "   " }, { recipientsRef: null }]) {
    const { ports, calls } = makePorts({ list: listOf({}) });
    await assert.rejects(extensionTool({ input, ports }), assertRefusal);
    assert.equal(calls.reads.length, 0);
    assert.equal(calls.saves.length, 0);
  }
});

test("R6 a list of another type and a list without a plain-object data are refused", async () => {
  const notPlain = [new Row("a"), new Map([["confirmedRecipients", [{ contactId: "a" }]]])];
  notPlain[0].confirmedRecipients = [{ contactId: "a" }];
  for (const list of [listOf({ confirmedRecipients: [{ contactId: "a" }] }, "@cinatra-ai/other:thing"), listOf(null), listOf([]), listOf("text"), ...notPlain.map((data) => listOf(data)), null]) {
    const { ports, calls } = makePorts({ list });
    await assert.rejects(extensionTool({ input: { recipientsRef: "list-1" }, ports }), assertRefusal);
    assert.equal(calls.saves.length, 0);
  }
});

test("R7 a blank or missing campaignId leaves campaignId out of every record", async () => {
  for (const input of [{ recipientsRef: "list-1" }, { recipientsRef: "list-1", campaignId: "  " }, { recipientsRef: "list-1", campaignId: 5 }]) {
    const { ports, calls } = makePorts({ list: listOf({ confirmedRecipients: [{ contactId: "a", email: "a@example.org" }, { email: "b@example.org" }] }) });
    await extensionTool({ input, ports });
    assert.equal(calls.saves.length, 2);
    for (const save of calls.saves) assert.equal(Object.hasOwn(save.data, "campaignId"), false);
  }
});

function keysAnywhere(value, found = []) {
  if (Array.isArray(value)) value.forEach((v) => keysAnywhere(v, found));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      found.push(k);
      keysAnywhere(v, found);
    }
  }
  return found;
}

test("R8 no record holds a run or external key and no port but objects was used", async () => {
  const smuggled = Object.fromEntries(FORBIDDEN.map((key) => [key, "x-1"]));
  const { ports, calls } = makePorts({
    list: listOf({ confirmedRecipients: [{ contactId: "k-1", email: "kay@example.org", ...smuggled, nested: { ...smuggled } }] }),
  });
  await extensionTool({ input: { recipientsRef: "list-1", campaignId: "camp-1", ...smuggled }, ports });
  assert.deepEqual(calls.saves, [
    { type: RECIPIENT, data: { runId: BOUND, contactKey: "contact:k-1", email: "kay@example.org", campaignId: "camp-1", confirmed: true } },
  ]);
  assert.ok(everySave.length > 0);
  for (const save of everySave) {
    const keys = keysAnywhere(save.data);
    for (const forbidden of FORBIDDEN) assert.ok(!keys.includes(forbidden), forbidden);
    assert.deepEqual(Object.keys(save), ["type", "data"]);
  }
  assert.deepEqual(everyOtherPort, []);
});
