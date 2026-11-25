// Declared module of the delivery agent: files one recipient record per
// confirmed recipient of the run.
//
// The delivery flow calls this module through its recipient filing step. The
// module reads the run's confirmed recipient list through the objects port,
// then saves one record of the recipient type for each confirmed recipient,
// one at a time and in list order. A record is keyed by the contact when the
// row names one (its contactId, else its recipientId), else by its address (the
// domain in lower case, the local part exactly as written), and carries the address only
// where the row has one, so a contact without an address is filed by its key
// alone. A contact that an earlier row of the same list already filed is not
// filed twice. Every row is checked before the first record is saved: a row
// that is not a recipient, or names neither a contact nor an address, has no
// key the recipient type accepts, so the call is refused and nothing is filed.
//
// The list is bounded before any row is looked into, by the rule the send's
// read step applies to the same list: a list of more rows than the limit,
// counted as handed in (a row that repeats a contact counts as well), is
// refused with TOO_MANY_RECIPIENTS and nothing is filed, so a run the send is
// certain to refuse leaves no record.
//
// Neither the run nor the scope is ever in this file: the host binds the run
// where a record carries the marker { boundRun: true }, and the port scopes
// every read and save. A refusal of the port reaches the caller unchanged, so
// a record the agent may not keep ends the run.

// The most rows of a confirmed recipient list one send takes: the value the
// send's read step declares as its own (a module of this package imports
// nothing, and a test keeps the two equal and runs both steps on the same
// lists).
const MAX_RECIPIENT_ROWS = 50;

const RECIPIENT_TYPE = "@cinatra-ai/email:recipient";
const RECIPIENTS_LIST_TYPE = "@cinatra-ai/campaigns:recipients";

class ExtensionToolCallRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "ExtensionToolCallRefusal";
  }
}

// A plain object is one made by an object literal or with a null prototype;
// an array, a date, a map or an instance of a class is not one.
const isPlainObject = (value) => {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
};

const trimmedOrNone = (value) =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

// The contact key of a draft or a recipient row: its contactId, else its
// recipientId. Each is trimmed first, and a blank one is absent. The send's
// read step (send-contents.mjs) declares the same function as a module of this
// package imports nothing; a test keeps the two texts equal and runs both on
// the same rows.
const contactKeyOf = (item) => trimmedOrNone(item.contactId) ?? trimmedOrNone(item.recipientId);

// What two rows without a contact must share to be one recipient: the address
// with its domain in lower case, which is how a domain is compared, and its
// local part exactly as written, because a local part may tell two mailboxes
// apart by case. Two addresses of one key are one mailbox in every reading; the
// record keeps the address as the row has it.
function addressKeyOf(address) {
  const at = address.lastIndexOf("@");
  return at < 0 ? address : `${address.slice(0, at)}@${address.slice(at + 1).toLowerCase()}`;
}

export async function extensionTool({ input, ports }) {
  const recipientsRef = trimmedOrNone(input?.recipientsRef);
  if (recipientsRef === undefined) {
    throw new ExtensionToolCallRefusal("The run names no confirmed recipient list to file records for.");
  }

  const list = await ports.objects.read({ objectId: recipientsRef });
  if (!list || list.type !== RECIPIENTS_LIST_TYPE || !isPlainObject(list.data)) {
    throw new ExtensionToolCallRefusal("The confirmed recipient list of this run is not a recipient list.");
  }

  const rows = Array.isArray(list.data.confirmedRecipients)
    ? list.data.confirmedRecipients
    : Array.isArray(list.data.recipients)
      ? list.data.recipients
      : [];
  if (rows.length > MAX_RECIPIENT_ROWS) {
    throw new ExtensionToolCallRefusal(
      `TOO_MANY_RECIPIENTS: The run hands in ${rows.length} confirmed recipients; one send takes at most ${MAX_RECIPIENT_ROWS}.`,
    );
  }
  const campaignId = trimmedOrNone(input?.campaignId);

  const filedKeys = new Set();
  const records = [];
  let skipped = 0;
  for (const [index, row] of rows.entries()) {
    const position = index + 1;
    if (!isPlainObject(row)) {
      throw new ExtensionToolCallRefusal(
        `Confirmed recipient ${position} of this run is not a recipient row, so no recipient record is filed for this run.`,
      );
    }
    const address = trimmedOrNone(row.email ?? row.recipientEmail);
    const contactId = contactKeyOf(row);
    if (contactId === undefined && address === undefined) {
      throw new ExtensionToolCallRefusal(
        `Confirmed recipient ${position} of this run names neither a contact nor an address, so no recipient record is filed for this run.`,
      );
    }
    const key = contactId !== undefined ? `contact:${contactId}` : `email:${addressKeyOf(address)}`;
    if (filedKeys.has(key)) {
      skipped += 1;
      continue;
    }
    filedKeys.add(key);

    const data = { runId: { boundRun: true }, contactKey: key };
    if (address !== undefined) data.email = address;
    if (campaignId !== undefined) data.campaignId = campaignId;
    data.confirmed = true;
    records.push(data);
  }

  let filed = 0;
  for (const data of records) {
    await ports.objects.save({ type: RECIPIENT_TYPE, data });
    filed += 1;
  }

  return { ok: true, filed, skipped };
}
