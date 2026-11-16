// The prepare step's texts say what the flow does - cinatra-ai/cinatra#3745.
//
// The prepare step returns a summary whose three members are all required by
// the structured-output contract the runtime derives from its declaration.
// A text that tells the model to leave a count out asks for an answer that
// contract refuses, and the step then hands on no content digest either. So
// an unreadable count is reported as 0, as the summary's own description
// says.
//
// The step also hands on the content digest of the read-only preview tool.
// This flow does not check that digest; refusing a send whose contents changed
// after the confirmation is the job of the application's send start. The texts
// say so, and do not state that the refusal happens here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const prepare = oas.$referenced_components?.prepare;
const PREVIEW_TOOL = "email_outreach_send_initial_preview";

const output = (title) => {
  const hits = (prepare?.outputs ?? []).filter((o) => o.title === title);
  assert.equal(hits.length, 1, `the prepare step has ${hits.length} outputs named ${title}`);
  return hits[0];
};

test("an unreadable count is reported as 0, because every summary key is required", () => {
  const required = output("summary").json_schema?.required ?? [];
  assert.deepEqual([...required].sort(), ["draftCount", "recipientCount", "scheduledAt"]);
  const system = prepare.data.system;
  assert.doesNotMatch(system, /\bOMIT\b/i, "the text tells the model to leave a required key out");
  assert.match(system, /cannot be read, set that count to 0/);
  assert.match(output("summary").description, /unreadable ref is reported as a count of 0/);
});

test("the digest's description leaves the refusal to the application's send start", () => {
  const text = output("contentDigest").description;
  assert.doesNotMatch(text, /so the send is refused/i, "the description states a refusal this flow does not make");
  assert.match(text, /This flow does not check the digest itself/);
  assert.match(text, /application's send start/);
});

test("the step's description names the preview tool and both outputs", () => {
  const text = prepare.metadata.cinatra.description;
  assert.ok(text.includes(PREVIEW_TOOL), "the description does not name the preview tool");
  assert.match(text, /contentDigest/);
  assert.match(text, /summary/);
});

test("the step's description reads all three records and reports an unreadable count as 0, as its text says", () => {
  assert.match(prepare.data.system, /MUST objects_get ALL THREE records/);
  const text = prepare.metadata.cinatra.description;
  assert.doesNotMatch(text, /optionally/i, "the description calls a read optional that the text requires");
  assert.match(text, /Reads all three records/);
  assert.match(text, /a count of 0 when a ref cannot be read/);
});
