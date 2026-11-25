// The declared module recipient-records.mjs: one recipient record per confirmed
// recipient, keyed by the contact or else by the address, with the address only
// where one exists; a row that names no recipient is refused before any record
// is saved - cinatra-ai/cinatra#3089.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
  { contactId: "c-1", email: "other@example.org" },
];

test("R1 one record per confirmed recipient, keyed by the contact or else by the address; a contact without an address is filed by its key alone", async () => {
  const { ports, calls } = makePorts({ list: listOf({ confirmedRecipients: R1_ROWS }) });
  const answer = await extensionTool({ input: { recipientsRef: " list-1 ", campaignId: "camp-1" }, ports });
  assert.deepEqual(calls.reads, [{ objectId: "list-1" }]);
  assert.deepEqual(calls.saves, [
    { type: RECIPIENT, data: { runId: BOUND, contactKey: "contact:c-1", email: "Ann@Example.org", campaignId: "camp-1", confirmed: true } },
    { type: RECIPIENT, data: { runId: BOUND, contactKey: "contact:c-2", campaignId: "camp-1", confirmed: true } },
    { type: RECIPIENT, data: { runId: BOUND, contactKey: "email:Cy@example.org", email: "Cy@Example.org", campaignId: "camp-1", confirmed: true } },
    { type: RECIPIENT, data: { runId: BOUND, contactKey: "email:dee@example.org", email: "dee@example.org", campaignId: "camp-1", confirmed: true } },
  ]);
  assert.equal(Object.hasOwn(calls.saves[1].data, "email"), false);
  assert.deepEqual(answer, { ok: true, filed: 4, skipped: 1 });
  await whitespaceCases();
});

async function whitespaceCases() {
  const bare = Object.assign(Object.create(null), { contactId: "c-bare" });
  const { ports, calls } = makePorts({
    list: listOf({
      confirmedRecipients: [
        { contactId: "c-9", email: "   " },
        { contactId: "  ", email: "Zed@Example.org" },
        bare,
      ],
    }),
  });
  const answer = await extensionTool({ input: { recipientsRef: "list-1" }, ports });
  assert.deepEqual(calls.saves.map((s) => s.data), [
    { runId: BOUND, contactKey: "contact:c-9", confirmed: true },
    { runId: BOUND, contactKey: "email:Zed@example.org", email: "Zed@Example.org", confirmed: true },
    { runId: BOUND, contactKey: "contact:c-bare", confirmed: true },
  ]);
  assert.deepEqual(answer, { ok: true, filed: 3, skipped: 0 });
}

test("R1b two addresses that differ in the case of the local part are two recipients; one that differs only in the case of the domain is one", async () => {
  const { ports, calls } = makePorts({
    list: listOf({
      confirmedRecipients: [
        { email: "Ann@Example.org" },
        { email: "ann@example.org" },
        { email: "Ann@EXAMPLE.ORG" },
      ],
    }),
  });
  const answer = await extensionTool({ input: { recipientsRef: "list-1" }, ports });
  assert.deepEqual(calls.saves.map((s) => [s.data.contactKey, s.data.email]), [
    ["email:Ann@example.org", "Ann@Example.org"],
    ["email:ann@example.org", "ann@example.org"],
  ]);
  assert.deepEqual(answer, { ok: true, filed: 2, skipped: 1 });
});

test("R2 the recipients array is used alone; confirmedRecipients wins when both exist", async () => {
  const only = makePorts({ list: listOf({ recipients: [{ contactId: "r-1", email: "r1@example.org" }, { contactId: "r-2", email: "r2@example.org" }] }) });
  const a = await extensionTool({ input: { recipientsRef: "list-1" }, ports: only.ports });
  assert.deepEqual(only.calls.saves.map((s) => s.data.contactKey), ["contact:r-1", "contact:r-2"]);
  assert.deepEqual(a, { ok: true, filed: 2, skipped: 0 });

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

test("R9 a row that is not a recipient, or names neither a contact nor an address, refuses the call before any record is saved", async () => {
  const refused = [
    { name: "Nobody" },
    { contactId: "  ", email: "   " },
    { contactId: 7, recipientEmail: null },
    "not-an-object",
    null,
    new Row("c-class"),
    new Date(0),
    new Map([["contactId", "c-map"]]),
    ["c-array"],
  ];
  for (const row of refused) {
    const { ports, calls } = makePorts({
      list: listOf({ confirmedRecipients: [{ contactId: "a", email: "a@example.org" }, { contactId: "b" }, row] }),
    });
    let caught;
    await extensionTool({ input: { recipientsRef: "list-1" }, ports }).catch((e) => { caught = e; });
    assert.ok(caught, "the call is refused");
    assertRefusal(caught);
    assert.match(caught.message, /\b3\b/);
    assert.equal(calls.saves.length, 0);
  }
});

// The send's read step refuses a confirmed recipient list of more than 50 rows
// (TOO_MANY_RECIPIENTS). This step runs earlier in the flow, so it holds the
// same bound over the same count, the rows of the list as handed in (a row
// that repeats a contact counts as well): a list the send is certain to refuse
// creates no record.

const sendContents = await import(new URL("../cinatra/tools/send-contents.mjs", import.meta.url));

const uniqueRows = (count) => Array.from({ length: count }, (_, k) => ({ contactId: `c-${k + 1}`, email: `p${k + 1}@example.org` }));

async function assertTooManyRecipients(data) {
  const { ports, calls } = makePorts({ list: listOf(data) });
  let caught;
  await extensionTool({ input: { recipientsRef: "list-1" }, ports }).catch((e) => { caught = e; });
  assert.ok(caught, "the call is refused");
  assertRefusal(caught);
  assert.match(caught.message, /^TOO_MANY_RECIPIENTS: /);
  assert.match(caught.message, /\b50\b/);
  assert.equal(calls.saves.length, 0, "nothing is saved for a list that is refused");
}

test("L1 51 unique valid rows are refused with the code of the send and nothing is saved", async () => {
  await assertTooManyRecipients({ confirmedRecipients: uniqueRows(51) });
  await assertTooManyRecipients({ recipients: uniqueRows(51) });
});

test("L2 50 valid rows are saved as before; a repeated row within 50 rows is skipped", async () => {
  const exact = makePorts({ list: listOf({ confirmedRecipients: uniqueRows(50) }) });
  assert.deepEqual(await extensionTool({ input: { recipientsRef: "list-1" }, ports: exact.ports }), { ok: true, filed: 50, skipped: 0 });
  assert.equal(exact.calls.saves.length, 50);

  const repeated = makePorts({ list: listOf({ confirmedRecipients: [...uniqueRows(40), ...uniqueRows(10)] }) });
  assert.deepEqual(await extensionTool({ input: { recipientsRef: "list-1" }, ports: repeated.ports }), { ok: true, filed: 40, skipped: 10 });
  assert.equal(repeated.calls.saves.length, 40);
});

test("L2b more than 50 rows are refused although fewer than 50 recipients are unique, and nothing is saved", async () => {
  await assertTooManyRecipients({ confirmedRecipients: [...uniqueRows(50), ...uniqueRows(10)] });
  await assertTooManyRecipients({ confirmedRecipients: [...uniqueRows(50), uniqueRows(1)[0]] });
  await assertTooManyRecipients({ recipients: [...uniqueRows(50), uniqueRows(1)[0]] });
});

/** Rows that count every time the module looks into one. */
function countingRows(count, keyOf) {
  const work = { looks: 0 };
  const rows = Array.from({ length: count }, (_, k) => ({
    get contactId() {
      work.looks += 1;
      return keyOf(k);
    },
  }));
  return { rows, work };
}

test("L3 a huge list is refused without processing its rows", async () => {
  const unique = countingRows(1_000_000, (k) => `c-${k}`);
  await assertTooManyRecipients({ confirmedRecipients: unique.rows });
  assert.equal(unique.work.looks, 0, "no row is looked into");

  const repeated = countingRows(1_000_000, () => "same");
  await assertTooManyRecipients({ confirmedRecipients: repeated.rows });
  assert.equal(repeated.work.looks, 0, "no row is looked into");
});

test("L4 a list of 51 rows is refused before any row is looked into", async () => {
  const unique = countingRows(51, (k) => `c-${k}`);
  await assertTooManyRecipients({ confirmedRecipients: unique.rows });
  assert.equal(unique.work.looks, 0, "no row is looked into");

  const repeated = countingRows(51, (k) => (k === 50 ? "c-0" : `c-${k}`));
  await assertTooManyRecipients({ confirmedRecipients: repeated.rows });
  assert.equal(repeated.work.looks, 0, "no row is looked into");
});

test("L5 the filing step and the read step take one limit", async () => {
  const limitOf = async (file) => {
    const source = await readFile(new URL(`../cinatra/tools/${file}`, import.meta.url), "utf8");
    const found = [...source.matchAll(/^const MAX_RECIPIENT_ROWS = (\d+);$/gm)];
    assert.equal(found.length, 1, `${file} declares the limit once`);
    return Number(found[0][1]);
  };
  const limit = await limitOf("recipient-records.mjs");
  assert.equal(limit, await limitOf("send-contents.mjs"));

  // Both steps give the same answer on the same lists at the boundary: the
  // filing step refuses exactly the lists the read step refuses for their
  // count, and saves nothing for them.
  const bundle = {
    objectId: "bundle",
    type: "@cinatra-ai/campaigns:email-draft-bundle",
    data: { drafts: [{ recipientId: "c-1", subject: "S", recipientEmail: "a@example.org" }] },
  };
  const input = {
    recipientsRef: "list",
    draftBundleRef: "bundle",
    callToAction: "Book a call.",
    emailBodies: JSON.stringify([{ artifactId: "b-1", representationRevisionId: "v-1" }]),
  };
  const readStepRefusesTheCount = async (rows) => {
    const objects = { list: { objectId: "list", type: LIST, data: { confirmedRecipients: rows } }, bundle };
    const ports = {
      objects: { read: async ({ objectId }) => objects[objectId] },
      artifacts: { read: async () => assert.fail("no artifact is read") },
    };
    // Past the count the read step refuses these lists for another reason (no
    // body is readable here); only the count's code is compared.
    const error = await sendContents.extensionTool({ input, ports }).then(() => null, (e) => e);
    return Boolean(error && /^TOO_MANY_RECIPIENTS: /.test(error.message));
  };
  const filingStepRefusesTheCount = async (rows) => {
    const { ports, calls } = makePorts({ list: { objectId: "list", type: LIST, data: { confirmedRecipients: rows } } });
    const error = await extensionTool({ input: { recipientsRef: "list" }, ports }).then(() => null, (e) => e);
    const refused = Boolean(error && /^TOO_MANY_RECIPIENTS: /.test(error.message));
    if (refused) assert.equal(calls.saves.length, 0, "the filing step saved a record for a refused list");
    return refused;
  };
  const withRepeat = (count) => [...uniqueRows(count - 1), uniqueRows(1)[0]];
  const cases = [
    ["50 unique rows", uniqueRows(limit), false],
    ["50 rows with one repeat", withRepeat(limit), false],
    ["51 unique rows", uniqueRows(limit + 1), true],
    ["51 rows with one repeat", withRepeat(limit + 1), true],
    ["60 rows, 50 unique", [...uniqueRows(limit), ...uniqueRows(10)], true],
  ];
  for (const [name, rows, refused] of cases) {
    assert.equal(await readStepRefusesTheCount(rows), refused, `the read step on ${name}`);
    assert.equal(await filingStepRefusesTheCount(rows), refused, `the filing step on ${name}`);
  }
});
