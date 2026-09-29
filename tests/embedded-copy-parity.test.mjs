// Parity of this flow with its embedded copy - cinatra-ai/cinatra#3096 item (7).
//
// The outreach pack (@cinatra-ai/email-outreach-agent) runs this agent as an
// embedded copy of this flow. The fixture
// tests/fixtures/email-outreach-delivery-subflow.json is that copy taken whole:
// the value of "email-delivery-subflow" in the outreach pack's cinatra/oas.json
// at commit 383410bbc049b030de14e57c5775952893ca83d4.
//
// This flow is the source of truth the copy is re-inlined from, so it must
// carry everything the copy carries. The rule is CONTAINS: with the copy's id
// prefix "sender-" stripped, every step of the copy is a step of this flow,
// and each carries every key and every titled entry the copy's step carries,
// with equal scalar values. Extra keys and extra entries are allowed: this flow
// keeps its own read-only prepare step, the summary the confirmation shows,
// its closing sentence after the send and its end with its typed defaults.
//
// Three paths are not compared, and each is held another way:
// - send.data.system and send.data.user, the send step's prompt texts: this
//   flow keeps its own, which name the send and status tools; the declared
//   outputs they name are compared.
// - send.metadata.cinatra.requiresApproval: the copy says true, this flow keeps
//   false. The confirmation gate is this agent's one pause and the send step's
//   screen is not a hold (cinatra-ai/cinatra#3094); the arm "6d - the declared
//   pauses are exactly the pauses the flow has" holds that.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const rawCopy = JSON.parse(
  readFileSync(join(root, "tests", "fixtures", "email-outreach-delivery-subflow.json"), "utf8"),
);

const PREFIX = "sender-";
const unprefix = (text) => (text.startsWith(PREFIX) ? text.slice(PREFIX.length) : text);

/** The copy with the prefix stripped from every string and every key. */
function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [unprefix(key), strip(inner)]));
  return typeof value === "string" ? unprefix(value) : value;
}

const copy = strip(rawCopy);
const refs = oas.$referenced_components ?? {};
const copyRefs = copy.$referenced_components ?? {};

/** A list the copy must carry: an absent or empty one would let an arm pass on nothing. */
function copyList(key) {
  const list = copy[key];
  assert.ok(Array.isArray(list) && list.length > 0, `the embedded copy carries no ${key} to compare`);
  return list;
}

/** The three paths held another way, as the header says. */
const SKIPPED = new Set([
  "send.data.system",
  "send.data.user",
  "send.metadata.cinatra.requiresApproval",
]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isTitledList = (list) =>
  list.length > 0 && list.every((entry) => isObject(entry) && typeof entry.title === "string");

/** Collect, into `missing`, everything `want` carries that `have` does not. */
function contains(have, want, path, missing) {
  if (SKIPPED.has(path)) return;
  if (Array.isArray(want)) {
    if (!Array.isArray(have)) {
      missing.push(`${path}: not a list`);
      return;
    }
    if (isTitledList(want)) {
      for (const entry of want) {
        const found = have.find((candidate) => isObject(candidate) && candidate.title === entry.title);
        if (!found) missing.push(`${path}[${entry.title}]`);
        else contains(found, entry, `${path}[${entry.title}]`, missing);
      }
      return;
    }
    want.forEach((entry, index) => {
      if (index >= have.length) missing.push(`${path}[${index}]`);
      else contains(have[index], entry, `${path}[${index}]`, missing);
    });
    return;
  }
  if (isObject(want)) {
    if (!isObject(have)) {
      missing.push(`${path}: not an object`);
      return;
    }
    for (const [key, inner] of Object.entries(want)) {
      if (!Object.hasOwn(have, key)) missing.push(`${path}.${key}`);
      else contains(have[key], inner, `${path}.${key}`, missing);
    }
    return;
  }
  if (have !== want) missing.push(`${path}: ${JSON.stringify(want)}, found ${JSON.stringify(have)}`);
}

const dataEdgesOf = (flow) =>
  new Set(
    (flow.data_flow_connections ?? []).map(
      (e) =>
        `${e.source_node.$component_ref}.${e.source_output} -> ${e.destination_node.$component_ref}.${e.destination_input}`,
    ),
  );
const controlEdgesOf = (flow) =>
  new Set(
    (flow.control_flow_connections ?? []).map(
      (e) =>
        `${e.from_node.$component_ref}${e.from_branch ? `[${e.from_branch}]` : ""} -> ${e.to_node.$component_ref}`,
    ),
  );

test("(7) every step of the embedded copy is a step of this flow, carrying all it carries", () => {
  const listed = new Set((oas.nodes ?? []).map((n) => n.$component_ref));
  const missing = [];
  for (const { $component_ref: id } of copyList("nodes")) {
    if (!listed.has(id)) missing.push(`${id}: not a step of this flow`);
    if (!refs[id]) {
      missing.push(`${id}: not defined in this flow`);
      continue;
    }
    contains(refs[id], copyRefs[id], id, missing);
  }
  assert.deepEqual(missing, [], "this flow lacks what the embedded copy carries: " + missing.join("; "));
});

test("(7) the flow takes every input and hands on every output the copy does", () => {
  const missing = [];
  contains(oas.inputs ?? [], copyList("inputs"), "inputs", missing);
  contains(oas.outputs ?? [], copyList("outputs"), "outputs", missing);
  assert.deepEqual(missing, [], "this flow lacks the copy's inputs or outputs: " + missing.join("; "));
});

test("(7) every data edge of the copy is a data edge of this flow", () => {
  copyList("data_flow_connections");
  const have = dataEdgesOf(oas);
  const missing = [...dataEdgesOf(copy)].filter((edge) => !have.has(edge));
  assert.deepEqual(missing, [], "this flow lacks the copy's data edges: " + missing.join("; "));
});

test("(7) every control edge of the copy is one of this flow, but the summary before the confirmation and the closing sentence after the send", () => {
  copyList("control_flow_connections");
  const have = controlEdgesOf(oas);
  // The copy's start goes straight to its gate; this flow's start goes to its
  // read-only prepare step, whose summary the confirmation shows. The copy's
  // send goes straight to its end; this flow's send goes on to its closing
  // sentence and then to its end.
  const missing = [...controlEdgesOf(copy)]
    .filter((edge) => edge !== "start -> approval_gate")
    .filter((edge) => edge !== "send -> end")
    .filter((edge) => !have.has(edge));
  for (const edge of ["start -> prepare", "prepare -> approval_gate", "send -> delivery_summary", "delivery_summary -> end"]) {
    if (!have.has(edge)) missing.push(edge);
  }
  assert.deepEqual(missing, [], "this flow lacks the copy's control edges: " + missing.join("; "));
});
