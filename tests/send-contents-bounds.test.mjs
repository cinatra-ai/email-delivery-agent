// The read step counts before it reads - cinatra-ai/cinatra#3089.
//
// The read step reads one artifact revision for each body of a mailed draft.
// Everything it is handed is counted first, against a named limit, and the
// artifacts are read only after every check that needs no content has passed.
// The arms run the module over stand-in ports that COUNT their reads.

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
const CTA = "Book a call.";

const draftOf = (i, { address = true } = {}) => ({
  recipientId: `k-${i}`,
  recipientName: `Person ${i}`,
  recipientEmail: address ? `p${i}@example.com` : "",
  subject: `Subject ${i}`,
  body: `Body ${i}. ${CTA}`,
});
const bodyOf = (i) => ({ artifactId: `b-${i}`, representationRevisionId: `v-${i}` });
const textsOf = (count) => Object.fromEntries(Array.from({ length: count }, (_, k) => [`b-${k + 1}`, `Body ${k + 1}. ${CTA}`]));
const range = (count) => Array.from({ length: count }, (_, k) => k + 1);

/** Stand-in ports that count every read, of an object and of an artifact. */
function ports({ drafts, rows = [], texts = textsOf(drafts.length), truncated = false }) {
  const objects = {
    [LIST_REF]: { objectId: LIST_REF, type: "@cinatra-ai/campaigns:recipients", data: { confirmedRecipients: rows } },
    [BUNDLE_REF]: { objectId: BUNDLE_REF, type: "@cinatra-ai/campaigns:email-draft-bundle", data: { drafts } },
  };
  const reads = { objects: [], artifacts: [], requests: [] };
  return {
    reads,
    objects: {
      async read({ objectId }) {
        reads.objects.push(objectId);
        return structuredClone(objects[objectId]);
      },
    },
    artifacts: {
      async contentRead(request) {
        reads.artifacts.push(request.artifactId);
        reads.requests.push(request);
        if (!(request.artifactId in texts)) throw new Error("not an artifact this run's organisation can see");
        return { ...request, objectType: BODY_TYPE, text: texts[request.artifactId], truncated };
      },
    },
  };
}

const run = (bodies, p) =>
  extensionTool({
    input: { recipientsRef: LIST_REF, draftBundleRef: BUNDLE_REF, emailBodies: JSON.stringify(bodies), callToAction: CTA },
    ports: p,
  });

async function refused(promise, pattern) {
  const error = await promise.then(
    () => assert.fail("the call was not refused"),
    (e) => e,
  );
  assert.equal(error.name, "ExtensionToolCallRefusal");
  if (pattern) assert.match(error.message, pattern);
  return error.message;
}

test("51 mailed drafts are refused with no read of any artifact, and the refusal names the code, the limit and the count", async () => {
  const drafts = range(51).map((i) => draftOf(i));
  const p = ports({ drafts });
  const message = await refused(run(range(51).map(bodyOf), p), /^TOO_MANY_BODIES: /);
  assert.match(message, /\b50\b/);
  assert.match(message, /\b51\b/);
  assert.equal(p.reads.artifacts.length, 0);
  // Bodies that name their contact, one fewer than the drafts: the drafts are counted on their own.
  const named = ports({ drafts });
  const message2 = await refused(run(range(50).map((i) => ({ ...bodyOf(i), contactId: `k-${i}` })), named), /^TOO_MANY_DRAFTS: /);
  assert.match(message2, /\b50\b/);
  assert.match(message2, /\b51\b/);
  assert.equal(named.reads.artifacts.length, 0);
});

test("a bundle of more than 50 drafts is refused with no read when only a few have an address", async () => {
  const drafts = range(60).map((i) => draftOf(i, { address: i <= 5 }));
  const p = ports({ drafts });
  const message = await refused(run(range(5).map((i) => ({ ...bodyOf(i), contactId: `k-${i}` })), p), /^TOO_MANY_DRAFTS: /);
  assert.match(message, /\b60\b/);
  assert.equal(p.reads.artifacts.length, 0);
});

test("200 supplied bodies are refused with no read at all, of an artifact or of an object", async () => {
  const drafts = range(3).map((i) => draftOf(i));
  const p = ports({ drafts });
  const message = await refused(run(range(200).map(bodyOf), p), /^TOO_MANY_BODIES: /);
  assert.match(message, /\b50\b/);
  assert.match(message, /\b200\b/);
  assert.equal(p.reads.artifacts.length, 0);
  assert.equal(p.reads.objects.length, 0);
});

test("a confirmed recipient list of more than 50 rows is refused with no read of any artifact", async () => {
  const drafts = range(3).map((i) => draftOf(i));
  const rows = range(120).map((i) => ({ contactId: `k-${i}`, name: `Person ${i}`, email: `p${i}@example.com` }));
  const p = ports({ drafts, rows });
  const message = await refused(run(range(3).map(bodyOf), p), /^TOO_MANY_RECIPIENTS: /);
  assert.match(message, /\b50\b/);
  assert.match(message, /\b120\b/);
  assert.equal(p.reads.artifacts.length, 0);
});

test("a bundle of 10 drafts of which 3 have an address reads exactly 3 bodies, the bodies of the mailed drafts", async () => {
  const drafts = range(10).map((i) => draftOf(i, { address: i === 2 || i === 5 || i === 9 }));
  const p = ports({ drafts });
  const answer = await run(range(10).map(bodyOf), p);
  assert.deepEqual(p.reads.artifacts, ["b-2", "b-5", "b-9"]);
  assert.deepEqual(answer.emailBodies.map((entry) => entry.artifactId), ["b-2", "b-5", "b-9"]);
  assert.equal(answer.recipients.length, 3);
});

test("a body for a draft that is not mailed is not read, so its text is not compared, but its shape and its place still are", async () => {
  const drafts = range(4).map((i) => draftOf(i, { address: i !== 3 }));
  // The body of the unmailed draft names an artifact the read would fail on and holds other text.
  const p = ports({ drafts, texts: { ...textsOf(4), "b-3": "Another text altogether." } });
  const answer = await run(range(4).map(bodyOf), p);
  assert.deepEqual(p.reads.artifacts, ["b-1", "b-2", "b-4"]);
  assert.equal(answer.emailBodies.length, 3);
  // No revision named: refused for its shape, with no read.
  const shape = ports({ drafts });
  const bodies = range(4).map(bodyOf);
  bodies[2] = { artifactId: "b-3" };
  await refused(run(bodies, shape), /Email body 3 .*no artifact revision/);
  assert.equal(shape.reads.artifacts.length, 0);
  // A body for a contact no draft names: refused for its place, with no read.
  const place = ports({ drafts });
  const named = [1, 2, 4].map((i) => ({ ...bodyOf(i), contactId: `k-${i}` }));
  named.push({ ...bodyOf(3), contactId: "k-99" });
  await refused(run(named, place), /k-99/);
  assert.equal(place.reads.artifacts.length, 0);
});

test("a mismatch that needs no content is refused with no read of any artifact", async () => {
  const drafts = range(3).map((i) => draftOf(i));
  const named = (list) => list.map(([i, contact]) => ({ ...bodyOf(i), contactId: contact }));
  const cases = [
    ["a body for an unknown contact", named([[1, "k-1"], [2, "k-2"], [3, "k-9"]]), /k-9/],
    ["two bodies for one contact", named([[1, "k-1"], [2, "k-2"], [3, "k-2"]]), /both for contact k-2/],
    ["one artifact named twice", [bodyOf(1), bodyOf(1), bodyOf(3)], /a second time/],
    ["bodies that do not line up with the drafts", [bodyOf(1), bodyOf(2)], /2 email bodies for 3 approved drafts/],
    ["a mailed draft without a body", named([[1, "k-1"], [2, "k-2"]]), /no approved body/],
    ["contacts named by some bodies only", [{ ...bodyOf(1), contactId: "k-1" }, bodyOf(2), bodyOf(3)], /some .*contact/i],
  ];
  for (const [name, bodies, pattern] of cases) {
    const p = ports({ drafts });
    await refused(run(bodies, p), pattern);
    assert.equal(p.reads.artifacts.length, 0, `${name}: an artifact was read`);
  }
  // A mailed draft without a subject, a mailed draft without a contact and a bundle that mails nothing.
  const noSubject = ports({ drafts: [draftOf(1), { ...draftOf(2), subject: " " }, draftOf(3)] });
  await refused(run(range(3).map(bodyOf), noSubject), /^SUBJECT_MISSING: /);
  assert.equal(noSubject.reads.artifacts.length, 0);
  const noContact = ports({ drafts: [draftOf(1), { recipientEmail: "x@example.com", subject: "S", body: "B" }, draftOf(3)] });
  await refused(run(range(3).map(bodyOf), noContact), /names no contact/);
  assert.equal(noContact.reads.artifacts.length, 0);
  const nothing = ports({ drafts: range(3).map((i) => draftOf(i, { address: false })) });
  await refused(run(range(3).map(bodyOf), nothing), /mail nothing/);
  assert.equal(nothing.reads.artifacts.length, 0);
});

test("each read is bounded by a maximum number of bytes, and a body that comes back cut off is still refused", async () => {
  const drafts = range(2).map((i) => draftOf(i));
  const p = ports({ drafts });
  await run(range(2).map(bodyOf), p);
  assert.equal(p.reads.requests.length, 2);
  for (const request of p.reads.requests) {
    assert.ok(Number.isInteger(request.maxBytes) && request.maxBytes > 0 && request.maxBytes <= 256 * 1024, "the read names no byte bound");
    assert.equal(request.objectType, BODY_TYPE);
  }
  const cut = ports({ drafts, truncated: true });
  await refused(run(range(2).map(bodyOf), cut), /too long/);
  assert.equal(cut.reads.artifacts.length, 1, "the read went on after a cut body");
});

test("50 mailed drafts are still sent: the limit is not reached", async () => {
  const drafts = range(50).map((i) => draftOf(i));
  const p = ports({ drafts });
  const answer = await run(range(50).map(bodyOf), p);
  assert.equal(answer.emailBodies.length, 50);
  assert.equal(p.reads.artifacts.length, 50);
});

// ---- the flow's schemas ----

const inputOf = (owner, title) => (owner.inputs ?? []).find((entry) => entry.title === title);
const outputOf = (owner, title) => (owner.outputs ?? []).find((entry) => entry.title === title);

test("the flow's schemas bound the lists the read and the send take: at most 50, at least 1", () => {
  const bounded = [
    ["the flow's bodies input", inputOf(oas, "emailBodies")],
    ["the start step's bodies input", inputOf(refs.start, "emailBodies")],
    ["the read step's bodies input", inputOf(refs.resolve_send, "emailBodies")],
    ["the read step's bodies output", outputOf(refs.resolve_send, "emailBodies")],
    ["the read step's recipients output", outputOf(refs.resolve_send, "recipients")],
    ["the send step's bodies input", inputOf(refs.send, "emailBodies")],
    ["the send step's recipients input", inputOf(refs.send, "recipients")],
  ];
  for (const [name, entry] of bounded) {
    assert.ok(entry, `${name} is missing`);
    assert.equal(entry.json_schema.maxItems, 50, `${name} has no maximum of 50`);
    assert.equal(entry.json_schema.minItems, 1, `${name} has no minimum of 1`);
  }
});
