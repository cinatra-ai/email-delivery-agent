// Declared module of the delivery agent: reads what the send will mail, so the
// publish card shows those values and nothing else.
//
// The delivery flow calls this module through its read step, directly before
// the send step. The send start reads two references only: the approved draft
// bundle and the confirmed recipient list. It mails each draft of the bundle
// that has an address, with the draft's own body. This module reads the same
// two references, which the send step passes to the send start unchanged,
// through the objects port and gives the send step:
//   - the recipients the send mails: one line per draft that has an address,
//     with the address chosen as the send chooses it (the draft's own address,
//     else the address of the confirmed recipient with the draft's contact);
//   - the email bodies of those drafts, as the artifact revisions the run
//     hands in, each one read through the artifacts port and compared with the
//     body of its draft.
// The run hands in one body revision per draft, in draft order. A revision of
// another type, a revision that is cut, or a revision whose text is not the
// body of its draft refuses the call, so the card never shows an email that
// the send would not mail. Nothing is written.

const RECIPIENTS_LIST_TYPE = "@cinatra-ai/campaigns:recipients";
const DRAFT_BUNDLE_TYPES = new Set([
  "@cinatra-ai/campaigns:email-draft-bundle",
  "@cinatra-ai/dynamic:email-drafts-bundle",
  "@cinatra-ai/dynamic:approved-email-draft-bundle",
]);
const EMAIL_BODY_TYPE = "@cinatra-ai/email:body";

class ExtensionToolCallRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "ExtensionToolCallRefusal";
  }
}

const isPlainObject = (value) => {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
};

const trimmedOrNone = (value) =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

const textOrEmpty = (value) => (typeof value === "string" ? value.trim() : "");

// An array value reaches the step as JSON text (the step renders it with
// tojson); a value that is already an array is taken as it is.
function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// The drafts the send start reads from the bundle (the same keys, in the same
// order of preference).
function draftsOf(data) {
  if (Array.isArray(data.drafts)) return data.drafts;
  if (Array.isArray(data.confirmedRecipients)) return data.confirmedRecipients;
  return [];
}

function recipientRowsOf(data) {
  if (Array.isArray(data.confirmedRecipients)) return data.confirmedRecipients;
  if (Array.isArray(data.recipients)) return data.recipients;
  return [];
}

// The address the send start mails a draft to: the draft's own address, else
// the address of the confirmed recipient with the draft's contact.
function sendAddressOf(draft, rows) {
  if (draft.recipientEmail) return draft.recipientEmail;
  if (draft.email) return draft.email;
  if (draft.contactId) {
    const match = rows.find((row) => isPlainObject(row) && row.contactId === draft.contactId);
    if (match?.email) return match.email;
    if (match?.recipientEmail) return match.recipientEmail;
  }
  return null;
}

// The body the send start mails for a draft.
const sendBodyOf = (draft) => draft.body ?? draft.bodyHtml ?? "";

// The confirmed recipient a draft is for, for its name and company only.
function rowOf(draft, rows, address) {
  const contact = trimmedOrNone(draft.contactId) ?? trimmedOrNone(draft.recipientId);
  const lower = address.toLowerCase();
  return (
    rows.find((row) => isPlainObject(row) && contact !== undefined && trimmedOrNone(row.contactId) === contact) ??
    rows.find(
      (row) =>
        isPlainObject(row) &&
        [row.email, row.recipientEmail].some((value) => typeof value === "string" && value.trim().toLowerCase() === lower),
    )
  );
}

function nameOf(draft, row) {
  const own = textOrEmpty(draft.recipientName);
  if (own !== "") return own;
  if (!row) return "";
  const name = textOrEmpty(row.name);
  if (name !== "") return name;
  return [textOrEmpty(row.firstName), textOrEmpty(row.lastName)].filter((part) => part !== "").join(" ");
}

const companyOf = (row) => (row ? textOrEmpty(row.company) || textOrEmpty(row.companyName) : "");

// Trailing white space is not part of what a reader sees in an email.
const sameText = (a, b) => a.replace(/\s+$/, "") === b.replace(/\s+$/, "");

export async function extensionTool({ input, ports }) {
  const recipientsRef = trimmedOrNone(input?.recipientsRef);
  const draftBundleRef = trimmedOrNone(input?.draftBundleRef);
  if (recipientsRef === undefined || draftBundleRef === undefined) {
    throw new ExtensionToolCallRefusal(
      "The run names no approved draft bundle or no confirmed recipient list, so there is nothing to send.",
    );
  }

  const list = await ports.objects.read({ objectId: recipientsRef });
  if (!list || list.type !== RECIPIENTS_LIST_TYPE || !isPlainObject(list.data)) {
    throw new ExtensionToolCallRefusal("The confirmed recipient list of this run is not a recipient list.");
  }
  const bundle = await ports.objects.read({ objectId: draftBundleRef });
  if (!bundle || !DRAFT_BUNDLE_TYPES.has(bundle.type) || !isPlainObject(bundle.data)) {
    throw new ExtensionToolCallRefusal("The approved draft bundle of this run is not a draft bundle.");
  }

  const rows = recipientRowsOf(list.data);
  const drafts = draftsOf(bundle.data);
  if (drafts.length === 0) {
    throw new ExtensionToolCallRefusal("The approved draft bundle of this run holds no draft, so there is nothing to send.");
  }

  const bodies = parseList(input?.emailBodies);
  if (bodies === undefined || bodies.length !== drafts.length) {
    throw new ExtensionToolCallRefusal(
      `The run hands in ${bodies === undefined ? "no list of" : bodies.length} email bodies for ${drafts.length} approved drafts; it must hand in one body for each draft, in draft order.`,
    );
  }

  const recipients = [];
  const emailBodies = [];
  for (const [index, draft] of drafts.entries()) {
    const position = index + 1;
    if (!isPlainObject(draft)) {
      throw new ExtensionToolCallRefusal(`Approved draft ${position} of this run is not a draft.`);
    }
    const body = bodies[index];
    const artifactId = isPlainObject(body) ? trimmedOrNone(body.artifactId) : undefined;
    const representationRevisionId = isPlainObject(body) ? trimmedOrNone(body.representationRevisionId) : undefined;
    if (artifactId === undefined || representationRevisionId === undefined) {
      throw new ExtensionToolCallRefusal(`Email body ${position} of this run names no artifact revision.`);
    }
    const read = await ports.artifacts.contentRead({ artifactId, representationRevisionId, objectType: EMAIL_BODY_TYPE });
    if (!read || read.objectType !== EMAIL_BODY_TYPE || typeof read.text !== "string") {
      throw new ExtensionToolCallRefusal(`Email body ${position} of this run is not an email body.`);
    }
    if (read.truncated === true) {
      throw new ExtensionToolCallRefusal(`Email body ${position} of this run is too long to compare with its draft.`);
    }
    if (read.representationRevisionId !== undefined && read.representationRevisionId !== representationRevisionId) {
      throw new ExtensionToolCallRefusal(`Email body ${position} of this run was read at another revision.`);
    }
    if (!sameText(read.text, String(sendBodyOf(draft)))) {
      throw new ExtensionToolCallRefusal(
        `Email body ${position} of this run is not the body of approved draft ${position}, which is the body the send mails.`,
      );
    }

    const address = sendAddressOf(draft, rows);
    if (!address) continue; // The send mails no draft without an address.
    const row = rowOf(draft, rows, String(address));
    recipients.push({ name: nameOf(draft, row), email: String(address), company: companyOf(row) });
    emailBodies.push({ artifactId, representationRevisionId });
  }

  if (recipients.length === 0) {
    throw new ExtensionToolCallRefusal("No approved draft of this run has an address, so the send would mail nothing.");
  }

  return { recipients, emailBodies };
}
