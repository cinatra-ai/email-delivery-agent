// The declared module recipient-records.mjs against the host's own rule for the
// recipient record: every record it saves must pass the schema the host
// registers for @cinatra-ai/email:recipient, because the host refuses any other
// record of that type once the type's claim is active - cinatra-ai/cinatra#3089.
//
// The schema below is the host's, copied verbatim from the registration of
// @cinatra-ai/email:recipient (packages/objects/src/integration/register-types.ts
// at cinatra-ai/cinatra a37d793c3135a07034692d5b629c67bada0cdb04, lines 500-510).
// It runs on the smallest rule set its text uses: an object rule checks only the
// keys it names, a string rule trims first when asked and then counts, and an
// optional rule admits a missing value.

import { test } from "node:test";
import assert from "node:assert/strict";

const { extensionTool } = await import(new URL("../cinatra/tools/recipient-records.mjs", import.meta.url));

function rule(check, state = { trim: false, min: 0, optional: false }) {
  return {
    trim: () => rule(check, { ...state, trim: true }),
    min: (n) => rule(check, { ...state, min: n }),
    optional: () => rule(check, { ...state, optional: true }),
    accepts: (value) => (value === undefined ? state.optional : check(value, state)),
  };
}

const z = {
  string: () => rule((value, s) => typeof value === "string" && (s.trim ? value.trim() : value).length >= s.min),
  boolean: () => rule((value) => typeof value === "boolean"),
  object: (shape) => ({
    safeParse: (data) => ({
      success:
        data !== null && typeof data === "object" && !Array.isArray(data) &&
        Object.entries(shape).every(([key, inner]) => inner.accepts(data[key])),
    }),
  }),
};

const hostRecipientSchema = z.object({
      runId: z.string().min(1),
      connectorId: z.string().optional(),
      contactKey: z.string().optional(),
      // `.trim().min(1)` normalizes and rejects a whitespace-only address — the
      // normalized-email fallback identity below must never collapse to an empty
      // contact key.
      email: z.string().trim().min(1),
      campaignId: z.string().optional(),
      confirmed: z.boolean().optional(),
    });

class InvalidActivatedTypePayloadError extends Error {
  constructor(type) {
    super(`invalid payload for activated type '${type}'`);
    this.name = "InvalidActivatedTypePayloadError";
  }
}

// A port that saves as the host does with the type's claim active: the run
// marker becomes the run's id, then a record that fails the host's schema is
// refused before anything is kept.
function hostPorts(rows, events = []) {
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
        if (type !== "@cinatra-ai/email:recipient" || !hostRecipientSchema.safeParse(stored).success) {
          throw new InvalidActivatedTypePayloadError(type);
        }
        kept.push(stored);
        return { objectId: `o-${kept.length}`, type, isNew: true };
      },
    },
  };
  return { ports, kept };
}

test("H1 the host's schema refuses a recipient record without an address and accepts one with it", () => {
  assert.equal(hostRecipientSchema.safeParse({ runId: "run-1", contactKey: "contact:c-2", confirmed: true }).success, false);
  assert.equal(hostRecipientSchema.safeParse({ runId: "run-1", contactKey: "contact:c-2", email: "   ", confirmed: true }).success, false);
  assert.equal(hostRecipientSchema.safeParse({ runId: "run-1", contactKey: "contact:c-2", email: "ben@example.org", confirmed: true }).success, true);
});

test("H2 a confirmed list that holds recipients without an address is filed under the host's schema, those recipients skipped", async () => {
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
    { runId: "run-1", contactKey: "contact:c-4", email: "dee@example.org", campaignId: "camp-1", confirmed: true },
  ]);
  assert.deepEqual(answer, { ok: true, filed: 2, skipped: 2, skippedWithoutAddress: 2 });
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
