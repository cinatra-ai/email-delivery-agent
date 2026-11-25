// Declared module of the delivery agent: reads what the send will mail, so the
// publish card shows those values and nothing else.
//
// The delivery flow calls this module through its read step, directly before
// the send step. The send start reads two references only: the approved draft
// bundle and the confirmed recipient list, and the approved bodies. It mails
// each draft of the bundle that has an address, with the text of the approved
// body revision joined to that draft. This module reads the same
// two references, which the send step passes to the send start unchanged,
// through the objects port and gives the send step:
//   - the recipients the send mails: one line per draft that has an address,
//     with the address chosen as the send chooses it (the draft's own address,
//     else the address of the confirmed recipient with the draft's contact).
//     This is the address the send start hands to the email pipeline. When the
//     workspace's development-mode recipient override is on, the pipeline mails
//     the override address instead; no port of this module can read that
//     setting, so the list does not show it;
//   - the approved body of each of those drafts, as the artifact revision the
//     run hands in, the contact of its draft (the draft's contactId, else its
//     recipientId), and the address and the subject of that draft as read here:
//     the value the send step passes to the send start as approvedBodies, and
//     the value the card's Emails row shows. The address and the subject are
//     the ones the card's Recipients row shows for the same draft. The send
//     start compares each message's address and subject with them and refuses
//     the whole send before any mail on a difference, so a draft or a list
//     changed while the card waits mails nothing the person did not see.
// A mailed draft without a subject is refused before the card
// (SUBJECT_MISSING): the card would show an email whose subject is unknown.
// A body is joined to its draft by the contact it names; bodies that name no
// contact are joined by position, one per draft of the bundle, in draft order.
// The call is refused before the card when a body cannot be joined to exactly
// one draft, when a draft the send mails has no body or names no contact, when
// one contact or one artifact occurs twice, when a body is of another type, cut
// or not the body of its draft, or when the send would mail more than 50
// drafts. So the card never shows an email that the send would not mail.
// Everything the step is handed is counted before anything is read: the
// bodies, the drafts of the bundle and the rows of the recipient list are each
// refused above a named limit (TOO_MANY_BODIES, TOO_MANY_DRAFTS,
// TOO_MANY_RECIPIENTS, and TOO_MANY_MAILED_DRAFTS for the drafts the send
// mails). The checks that need no content come next: the shape of every body,
// its place among the drafts, and what each mailed draft needs (an address, a
// contact, a body, a subject). Only then are artifacts read, one for each body
// of a MAILED draft, each read bounded to MAX_BODY_BYTES. A body handed in for
// a draft the send does not mail is not read: it is not sent, so only its shape
// and its place in the join are checked.
// The step also hands on the call to action the card's "Call to action" row
// shows, and only one that every mailed body carries in its text (compared as
// a body is compared with its draft: trailing white space is not part of it).
// A run without a call to action, or with one that a mailed body does not
// carry, is refused before the card. The drafts hold no call-to-action field
// of their own, so the text of the mailed body is what is compared. The
// refusal names a code and never the call to action itself.
// Nothing is written.

const RECIPIENTS_LIST_TYPE = "@cinatra-ai/campaigns:recipients";
const DRAFT_BUNDLE_TYPES = new Set([
  "@cinatra-ai/campaigns:email-draft-bundle",
  "@cinatra-ai/dynamic:email-drafts-bundle",
  "@cinatra-ai/dynamic:approved-email-draft-bundle",
]);
const EMAIL_BODY_TYPE = "@cinatra-ai/email:body";
// The send start takes at most 50 approved bodies, the cap of the publish
// card's artifacts row, so every body the card shows fits one send.
const MAX_MAILED_DRAFTS = 50;
// The most drafts a bundle may hold, the most bodies a run may hand in and the
// most rows a confirmed recipient list may hold. The drafting step files at most
// 50 drafts for one run, one body for each, for the recipients of that run, so a
// bundle, its bodies and its list never legitimately hold more; a bundle may
// hold drafts without an address, which are not mailed, and these count here
// as well. The limits are checked before any artifact is read.
const MAX_BUNDLE_DRAFTS = 50;
const MAX_BODIES = 50;
// The filing step (recipient-records.mjs) declares the same value, as a module
// of this package imports nothing; a test keeps the two equal.
const MAX_RECIPIENT_ROWS = 50;
// The most bytes of one body a read takes: the cap the artifacts port itself
// applies to any text read. A body that does not fit comes back cut off and is
// refused.
const MAX_BODY_BYTES = 256 * 1024;

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

// The subject of a draft as the bundle holds it, which is the subject the send
// start mails and compares; a missing or blank one is none.
const subjectOf = (draft) =>
  typeof draft.subject === "string" && draft.subject.trim() !== "" ? draft.subject : undefined;

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
const withoutTrailingSpace = (text) => text.replace(/\s+$/, "");
const sameText = (a, b) => withoutTrailingSpace(a) === withoutTrailingSpace(b);

function assertWithinLimit(code, what, count, limit) {
  if (count > limit) {
    throw new ExtensionToolCallRefusal(
      `${code}: The run hands in ${count} ${what}; one send takes at most ${limit}.`,
    );
  }
}

export async function extensionTool({ input, ports }) {
  const recipientsRef = trimmedOrNone(input?.recipientsRef);
  const draftBundleRef = trimmedOrNone(input?.draftBundleRef);
  if (recipientsRef === undefined || draftBundleRef === undefined) {
    throw new ExtensionToolCallRefusal(
      "The run names no approved draft bundle or no confirmed recipient list, so there is nothing to send.",
    );
  }

  const callToAction = trimmedOrNone(input?.callToAction);
  if (callToAction === undefined) {
    throw new ExtensionToolCallRefusal(
      "CALL_TO_ACTION_MISSING: The run names no call to action, so the publish card cannot show the call to action of the emails.",
    );
  }

  // Counted before anything is read: the bodies are the input of the step.
  const bodies = parseList(input?.emailBodies);
  if (bodies === undefined || bodies.length === 0) {
    throw new ExtensionToolCallRefusal(
      "The run hands in no email bodies; it must hand in the approved body of each draft it mails.",
    );
  }
  assertWithinLimit("TOO_MANY_BODIES", "email bodies", bodies.length, MAX_BODIES);

  const list = await ports.objects.read({ objectId: recipientsRef });
  if (!list || list.type !== RECIPIENTS_LIST_TYPE || !isPlainObject(list.data)) {
    throw new ExtensionToolCallRefusal("The confirmed recipient list of this run is not a recipient list.");
  }
  const bundle = await ports.objects.read({ objectId: draftBundleRef });
  if (!bundle || !DRAFT_BUNDLE_TYPES.has(bundle.type) || !isPlainObject(bundle.data)) {
    throw new ExtensionToolCallRefusal("The approved draft bundle of this run is not a draft bundle.");
  }

  const rows = recipientRowsOf(list.data);
  assertWithinLimit("TOO_MANY_RECIPIENTS", "confirmed recipients", rows.length, MAX_RECIPIENT_ROWS);
  const drafts = draftsOf(bundle.data);
  if (drafts.length === 0) {
    throw new ExtensionToolCallRefusal("The approved draft bundle of this run holds no draft, so there is nothing to send.");
  }
  assertWithinLimit("TOO_MANY_DRAFTS", "approved drafts", drafts.length, MAX_BUNDLE_DRAFTS);

  // The bodies the run hands in, each naming one artifact revision, at most once.
  const handed = [];
  const namedArtifacts = new Set();
  for (const [index, body] of bodies.entries()) {
    const position = index + 1;
    const artifactId = isPlainObject(body) ? trimmedOrNone(body.artifactId) : undefined;
    const representationRevisionId = isPlainObject(body) ? trimmedOrNone(body.representationRevisionId) : undefined;
    if (artifactId === undefined || representationRevisionId === undefined) {
      throw new ExtensionToolCallRefusal(`Email body ${position} of this run names no artifact revision.`);
    }
    if (namedArtifacts.has(artifactId)) {
      throw new ExtensionToolCallRefusal(`Email body ${position} of this run names artifact ${artifactId} a second time.`);
    }
    namedArtifacts.add(artifactId);
    const contactId = isPlainObject(body) ? trimmedOrNone(body.contactId) : undefined;
    handed.push({ position, artifactId, representationRevisionId, contactId });
  }

  // The drafts, each with the contact the send start joins a body on (the
  // draft's contactId, else its recipientId) and the address it mails to. One
  // contact on two drafts joins no body exactly, so it is refused.
  const draftByContact = new Map();
  const entries = drafts.map((draft, index) => {
    const position = index + 1;
    if (!isPlainObject(draft)) {
      throw new ExtensionToolCallRefusal(`Approved draft ${position} of this run is not a draft.`);
    }
    const contact = trimmedOrNone(draft.contactId) ?? trimmedOrNone(draft.recipientId);
    if (contact !== undefined) {
      if (draftByContact.has(contact)) {
        throw new ExtensionToolCallRefusal(
          `Approved drafts ${draftByContact.get(contact) + 1} and ${position} of this run are both for contact ${contact}, so no body can be joined to exactly one of them.`,
        );
      }
      draftByContact.set(contact, index);
    }
    const address = sendAddressOf(draft, rows);
    return { draft, position, contact, address: address ? String(address) : null, body: undefined };
  });

  // Join each body to exactly one draft: by the contact it names, or, when no
  // body names a contact, by its position among all drafts of the bundle (the
  // drafting step files one body per draft, in draft order).
  const named = handed.filter((body) => body.contactId !== undefined).length;
  if (named !== 0 && named !== handed.length) {
    throw new ExtensionToolCallRefusal(
      "Some email bodies of this run name the contact of their draft and some do not, so they cannot be joined to their drafts.",
    );
  }
  if (named === 0) {
    if (handed.length !== drafts.length) {
      throw new ExtensionToolCallRefusal(
        `The run hands in ${handed.length} email bodies for ${drafts.length} approved drafts; bodies that name no contact must be one for each draft, in draft order.`,
      );
    }
    for (const [index, body] of handed.entries()) entries[index].body = body;
  } else {
    const bodyByContact = new Map();
    for (const body of handed) {
      const earlier = bodyByContact.get(body.contactId);
      if (earlier) {
        throw new ExtensionToolCallRefusal(
          `Email bodies ${earlier.position} and ${body.position} of this run are both for contact ${body.contactId}.`,
        );
      }
      bodyByContact.set(body.contactId, body);
      const index = draftByContact.get(body.contactId);
      if (index === undefined) {
        throw new ExtensionToolCallRefusal(
          `Email body ${body.position} of this run is for contact ${body.contactId}, which no approved draft of this run names.`,
        );
      }
      entries[index].body = body;
    }
  }

  // The drafts the send mails: each one has an address, a contact, a body and a
  // subject. All of this is settled before any artifact is read.
  const mailed = [];
  for (const entry of entries) {
    if (!entry.address) continue; // The send mails no draft without an address.
    if (entry.contact === undefined) {
      throw new ExtensionToolCallRefusal(
        `Approved draft ${entry.position} of this run has an address but names no contact, so the send cannot join its approved body to it.`,
      );
    }
    if (entry.body === undefined) {
      throw new ExtensionToolCallRefusal(
        `Approved draft ${entry.position} of this run has an address but no approved body.`,
      );
    }
    const subject = subjectOf(entry.draft);
    if (subject === undefined) {
      throw new ExtensionToolCallRefusal(
        `SUBJECT_MISSING: Approved draft ${entry.position} of this run has an address but no subject, so the publish card cannot show the subject of its email.`,
      );
    }
    mailed.push({ ...entry, subject });
  }
  if (mailed.length === 0) {
    throw new ExtensionToolCallRefusal("No approved draft of this run has an address, so the send would mail nothing.");
  }
  // The bundle limit already keeps this below the send's own limit; the check
  // stays so the two limits cannot drift apart unnoticed.
  if (mailed.length > MAX_MAILED_DRAFTS) {
    throw new ExtensionToolCallRefusal(
      `TOO_MANY_MAILED_DRAFTS: The run would mail ${mailed.length} approved drafts; one send takes the approved bodies of at most ${MAX_MAILED_DRAFTS}.`,
    );
  }

  // Only now are artifacts read: the body of each mailed draft, and no other.
  // It is the body of its draft, which is the body the send mails. A body
  // handed in for a draft that is not mailed is not read. Each read is bounded.
  const recipients = [];
  const emailBodies = [];
  for (const entry of mailed) {
    const { position, artifactId, representationRevisionId } = entry.body;
    const read = await ports.artifacts.contentRead({
      artifactId,
      representationRevisionId,
      objectType: EMAIL_BODY_TYPE,
      maxBytes: MAX_BODY_BYTES,
    });
    if (!read || read.objectType !== EMAIL_BODY_TYPE || typeof read.text !== "string") {
      throw new ExtensionToolCallRefusal(`Email body ${position} of this run is not an email body.`);
    }
    if (read.truncated === true) {
      throw new ExtensionToolCallRefusal(`Email body ${position} of this run is too long to compare with its draft.`);
    }
    if (read.representationRevisionId !== undefined && read.representationRevisionId !== representationRevisionId) {
      throw new ExtensionToolCallRefusal(`Email body ${position} of this run was read at another revision.`);
    }
    if (!sameText(read.text, String(sendBodyOf(entry.draft)))) {
      throw new ExtensionToolCallRefusal(
        `Email body ${position} of this run is not the body of approved draft ${entry.position}, which is the body the send mails.`,
      );
    }
    if (!withoutTrailingSpace(read.text).includes(callToAction)) {
      throw new ExtensionToolCallRefusal(
        `CALL_TO_ACTION_NOT_IN_EMAIL: Email body ${position} of this run does not carry the call to action of the run, so the publish card would show a call to action that the send does not mail.`,
      );
    }
    const row = rowOf(entry.draft, rows, entry.address);
    recipients.push({ name: nameOf(entry.draft, row), email: entry.address, company: companyOf(row), subject: entry.subject });
    emailBodies.push({
      artifactId,
      representationRevisionId,
      contactId: entry.contact,
      recipientEmail: entry.address,
      subject: entry.subject,
    });
  }

  return { recipients, emailBodies, callToAction };
}
