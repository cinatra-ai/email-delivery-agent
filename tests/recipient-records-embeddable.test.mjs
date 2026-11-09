// cinatra#4154 part C: the delivery agent's own consent that an agent
// embedding its flow may run `recipient_records` from this package.
//
// The host reads `cinatra.tools[].embeddable` as an OWN data property of the
// tool entry, and only the JSON boolean `true` is consent. A missing key or an
// own `false` means not embeddable (the entry is accepted, the embedded call is
// refused as not embeddable); inherited values are ignored; only an own
// non-boolean value invalidates the declaration list. So this asserts the
// shipped manifest declares exactly that, on exactly that one tool.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tools = pkg.cinatra?.tools ?? [];

test("cinatra.tools declares recipient_records once, at the built module", () => {
  const entries = tools.filter((t) => t.name === "recipient_records");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].module, "./cinatra/tools/recipient-records.mjs");
});

test("recipient_records declares embeddable as the own JSON boolean true", () => {
  const entry = tools.find((t) => t.name === "recipient_records");
  assert.ok(entry, "recipient_records is declared");
  assert.ok(
    Object.prototype.hasOwnProperty.call(entry, "embeddable"),
    "embeddable is an own key of the tool entry",
  );
  assert.strictEqual(entry.embeddable, true);
});

test("a tool entry carries only name, module and the embeddable flag", () => {
  for (const entry of tools) {
    for (const key of Object.keys(entry)) {
      assert.ok(["name", "module", "embeddable"].includes(key), `unexpected key ${key}`);
    }
    if ("embeddable" in entry) assert.equal(typeof entry.embeddable, "boolean");
  }
});
