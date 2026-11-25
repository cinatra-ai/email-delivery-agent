// Lifecycle D W8 — the email delivery agent's plain ending (cinatra#3096 item 19).
//
// (19) A delivery run closes with a plain message after the send: how many
// campaign emails went out, or that the send stopped, with the reason when the
// send reports one, or that no send ran — never with the raw answer. The
// message states the counts the send reports also when the send failed: how many
// emails this run sent, how many an earlier call had already sent, and how many
// are in doubt (a person checks those with the mail provider).
// The send start's answer (its status, the counts and the reason of a failure)
// is still handed on at the end for an agent that started the run.
//
// Three more arms check this flow against the rules the runtime applies when
// it mounts a flow, the same rules cinatra-ai/email-outreach-agent checks for
// its own flow: (A) each input a step needs gets a value on each path to that
// step, (B) a closing statement declares no input its sentence does not read,
// and (C) each declared default is of the type its entry declares.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
const oas = read("cinatra/oas.json");
const pkg = read("package.json");

const refs = oas.$referenced_components;
const nodesOfType = (type) => Object.values(refs).filter((n) => n.component_type === type);
const controlEdges = (oas.control_flow_connections ?? []).map((e) => ({
  from: e.from_node.$component_ref,
  to: e.to_node.$component_ref,
  branch: e.from_branch,
}));
const hasEdge = (from, to, branch) =>
  controlEdges.some((e) => e.from === from && e.to === to && (branch === undefined || e.branch === branch));
const dataEdges = (oas.data_flow_connections ?? []).map((e) => [
  e.source_node.$component_ref + "." + e.source_output,
  e.destination_node.$component_ref + "." + e.destination_input,
]);
const countDataEdges = (from, to) => dataEdges.filter(([f, t]) => f === from && t === to).length;
const outsideComment = (message) => String(message ?? "").replace(/\{#[\s\S]*?#\}/g, "");

/**
 * A renderer for the subset of the template language the closing message uses:
 * comments, if / elif / else / endif blocks, {{ name }} output, and conditions
 * built from names, quoted text, numbers, ==, !=, and, or, not and brackets. It
 * is not Jinja itself; a construct outside the subset throws, so the message
 * cannot grow one that this test does not render.
 */
function renderTemplate(source, context) {
  const tokens = [];
  const pattern = /\{#[\s\S]*?#\}|\{%\s*([\s\S]*?)\s*%\}|\{\{\s*([\s\S]*?)\s*\}\}/g;
  let at = 0;
  for (let m; (m = pattern.exec(source)); at = pattern.lastIndex) {
    if (m.index > at) tokens.push({ text: source.slice(at, m.index) });
    if (!m[0].startsWith("{#")) tokens.push(m[1] !== undefined ? { tag: m[1] } : { out: m[2] });
  }
  if (at < source.length) tokens.push({ text: source.slice(at) });

  const operators = { "==": "===", "!=": "!==", and: "&&", or: "||", not: "!", "(": "(", ")": ")" };
  const condition = (expression) => {
    const piece = /\s*('[^']*'|"[^"]*"|\d+|==|!=|[()]|[A-Za-z_]\w*)/y;
    let js = "";
    let end = 0;
    for (let m; (m = piece.exec(expression)); end = piece.lastIndex) {
      const word = m[1];
      if (Object.hasOwn(operators, word)) js += operators[word];
      else if (/^['"\d]/.test(word)) js += word;
      else if (Object.hasOwn(context, word)) js += `context.${word}`;
      else throw new Error(`the template reads ${word}, which is not an input`);
      js += " ";
    }
    if (expression.slice(end).trim() !== "") throw new Error(`unsupported condition: ${expression}`);
    return Boolean(Function("context", `return (${js});`)(context));
  };

  let cursor = 0;
  /** Renders tokens until a tag in `stops` (not consumed); `on` is false inside a branch not taken. */
  const block = (on, stops) => {
    let out = "";
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (token.tag !== undefined && stops.includes(token.tag.split(" ")[0])) return out;
      cursor += 1;
      if (token.text !== undefined) {
        if (on) out += token.text;
      } else if (token.out !== undefined) {
        if (!Object.hasOwn(context, token.out)) throw new Error(`the template prints ${token.out}, which is not an input`);
        if (on) out += String(context[token.out]);
      } else if (token.tag.startsWith("if ")) {
        let taken = on && condition(token.tag.slice(3));
        out += block(taken, ["elif", "else", "endif"]);
        for (;;) {
          const tag = tokens[cursor++]?.tag;
          if (tag === undefined) throw new Error("an if block is not closed");
          if (tag === "endif") break;
          const wanted = tag === "else" ? on && !taken : tag.startsWith("elif ") ? on && !taken && condition(tag.slice(5)) : null;
          if (wanted === null) throw new Error(`unsupported tag: ${tag}`);
          out += block(wanted, ["elif", "else", "endif"]);
          taken = taken || wanted;
        }
      } else {
        throw new Error(`unsupported tag: ${token.tag}`);
      }
    }
    return out;
  };
  return block(true, []);
}

const render = (answer) =>
  renderTemplate(refs.delivery_summary.message, {
    status: "",
    sentCount: 0,
    errorMessage: "",
    alreadySentCount: 0,
    inDoubtCount: 0,
    ...answer,
  });

test("(19) the run ends in plain language after the send, never in the envelope", () => {
  const summary = refs.delivery_summary;
  assert.ok(summary, "the run has no closing statement");
  assert.equal(summary.component_type, "OutputMessageNode");
  assert.ok(oas.nodes.some((n) => n.$component_ref === "delivery_summary"), "the closing statement is not a step of the flow");
  assert.ok(hasEdge("send", "delivery_summary"), "the send does not lead to the closing statement");
  assert.ok(hasEdge("delivery_summary", "end"), "the closing statement does not lead to the end");
  assert.ok(!hasEdge("send", "end"), "the run still jumps from the send straight to its end");
  // The send start's answer is still handed on at the end, for an agent that started the run.
  assert.deepEqual(refs.end.outputs.map((o) => o.title), [
    "sendStatus",
    "sentCount",
    "sendErrorMessage",
    "alreadySentCount",
    "inDoubtCount",
  ]);
  assert.deepEqual(oas.outputs.map((o) => o.title), refs.end.outputs.map((o) => o.title));
  assert.equal(countDataEdges("send.status", "end.sendStatus"), 1);
  assert.equal(countDataEdges("send.sentCount", "end.sentCount"), 1);
  assert.equal(countDataEdges("send.errorMessage", "end.sendErrorMessage"), 1);
  assert.equal(countDataEdges("send.alreadySentCount", "end.alreadySentCount"), 1);
  assert.equal(countDataEdges("send.inDoubtCount", "end.inDoubtCount"), 1);
});

test("(19) the closing statement reads the send start's answer, counts included", () => {
  const summary = refs.delivery_summary;
  assert.ok(summary, "the run has no closing statement");
  assert.equal(summary.metadata?.cinatra?.purpose, "plain-language-delivery-ending");
  assert.deepEqual(summary.inputs, [
    { title: "status", type: "string", default: "" },
    { title: "sentCount", type: "integer", default: 0 },
    { title: "errorMessage", type: "string", default: "" },
    { title: "alreadySentCount", type: "integer", default: 0 },
    { title: "inDoubtCount", type: "integer", default: 0 },
  ]);
  for (const name of ["status", "sentCount", "errorMessage", "alreadySentCount", "inDoubtCount"]) {
    assert.equal(countDataEdges(`send.${name}`, `delivery_summary.${name}`), 1, `the closing statement's ${name} is not the send's`);
  }
  const send = refs.send.outputs.map(({ title, type, default: fallback }) => ({ title, type, default: fallback }));
  for (const name of ["alreadySentCount", "inDoubtCount"]) {
    assert.deepEqual(send.find((o) => o.title === name), { title: name, type: "integer", default: 0 });
  }
});

// The send start answers failed for a send that stopped part way, and then its
// sentCount is what this call handed over. Every message below is rendered
// from the template of the flow; the counts are stated truthfully, so that a
// person who retries knows what is safe.
test("(19) a completed send says how many emails were sent, as before", () => {
  assert.equal(render({ status: "completed", sentCount: 1 }), "1 campaign email was sent.");
  assert.equal(render({ status: "completed", sentCount: 3 }), "3 campaign emails were sent.");
  assert.equal(render({ status: "completed", sentCount: 0 }), "The send finished, but no campaign email went out.");
});

test("(19) a failed send gives the reason, then the count of emails sent anyway, and says that a repeat does not send them again", () => {
  const reason = "the mail provider failed on draft 4";
  assert.equal(
    render({ status: "failed", sentCount: 3, errorMessage: reason }),
    `The send stopped: ${reason}\n\n3 emails went out in this run, and repeating the send will not send them again.`,
  );
  assert.equal(
    render({ status: "failed", sentCount: 1, errorMessage: reason }),
    `The send stopped: ${reason}\n\n1 email went out in this run, and repeating the send will not send it again.`,
  );
});

test("(19) a failed send that sent nothing says that no email was sent in this run, and only then", () => {
  const none = render({ status: "failed", sentCount: 0, errorMessage: "no mail provider was reached" });
  assert.equal(none, "The send stopped: no mail provider was reached\n\nNo email was sent in this run.");
  assert.match(render({ status: "failed", sentCount: 0 }), /^The send stopped, and it gave no reason\.\n\nNo email was sent in this run\.$/);
  // With sent emails, or with emails in doubt, the sentence is never "none sent".
  assert.doesNotMatch(render({ status: "failed", sentCount: 3, errorMessage: "x" }), /No email was sent/);
  assert.doesNotMatch(render({ status: "failed", sentCount: 0, inDoubtCount: 2, errorMessage: "x" }), /No email was sent/);
});

test("(19) a failed send with emails in doubt names the count and tells the person to check with the mail provider", () => {
  const message = render({ status: "failed", sentCount: 0, inDoubtCount: 2, errorMessage: "the mail provider failed on draft 2" });
  assert.equal(
    message,
    "The send stopped: the mail provider failed on draft 2\n\nNo email is confirmed as sent in this run." +
      " 2 emails may or may not have gone out: check with your mail provider before sending again. This send does not send them again.",
  );
  assert.match(render({ status: "failed", sentCount: 2, inDoubtCount: 1, errorMessage: "x" }), /2 emails went out in this run.* 1 email may or may not have gone out: check with your mail provider before sending again\. This send does not send it again\.$/);
});

test("(19) a send that skipped emails sent by an earlier call says how many", () => {
  assert.equal(
    render({ status: "completed", sentCount: 2, alreadySentCount: 4 }),
    "2 campaign emails were sent. 4 emails had already been sent before this send, and were skipped.",
  );
  assert.equal(
    render({ status: "completed", sentCount: 0, alreadySentCount: 1 }),
    "The send finished, but no campaign email went out. 1 email had already been sent before this send, and was skipped.",
  );
  assert.match(render({ status: "failed", sentCount: 1, alreadySentCount: 4, errorMessage: "x" }), /4 emails had already been sent before this send, and were skipped\.$/);
});

test("(19) a run with no answer from the send says no email was sent, unless the answer carries a count", () => {
  assert.equal(render({}), "No campaign email was sent in this run.");
  const unclear = render({ sentCount: 2 });
  assert.match(unclear, /^The send did not report a result\./);
  assert.match(unclear, /2 emails went out in this run/);
});

test("(19) the counts of a plain completed send add nothing to its sentence", () => {
  assert.equal(render({ status: "completed", sentCount: 5, alreadySentCount: 0, inDoubtCount: 0 }), "5 campaign emails were sent.");
});

test("(19) the closing statement follows the send, the send follows the read step alone, and the read step follows the filing step alone", () => {
  const into = (id) => controlEdges.filter((e) => e.to === id).map((e) => e.from).sort();
  assert.deepEqual(into("delivery_summary"), ["send"]);
  assert.deepEqual(into("send"), ["resolve_send"]);
  assert.deepEqual(into("resolve_send"), ["file_recipients"]);
  assert.deepEqual(into("file_recipients"), ["prepare"]);
  assert.deepEqual(into("end"), ["delivery_summary"]);
});

// ---------------------------------------------------------------------------
// (A) every required step input has a source on every path that reaches it
// ---------------------------------------------------------------------------

/** The inputs a node CONSUMES: an EndNode names them under `outputs`, every
 *  other node declares `inputs`. */
function consumedInputs(node) {
  if (node.component_type === "EndNode") return node.outputs ?? [];
  return node.inputs ?? [];
}

/** Walk the flow the way the runtime loader does, returning each input it
 *  would demand from the StartStep. */
function unsourcedInputs() {
  const steps = new Map();
  for (const ref of oas.nodes ?? []) steps.set(ref.$component_ref, refs[ref.$component_ref]);
  const beginId = oas.start_node.$component_ref;
  const startTitles = new Set((steps.get(beginId)?.inputs ?? []).map((i) => i.title));
  const flowDataEdges = (oas.data_flow_connections ?? []).map((e) => ({
    from: e.source_node.$component_ref,
    key: `${e.destination_node.$component_ref}.${e.destination_input}`,
  }));
  const successors = (id) => controlEdges.filter((e) => e.from === id).map((e) => e.to);

  const violations = [];
  const visited = new Map();
  const queue = [[beginId, new Set()]];
  while (queue.length > 0) {
    const [id, incoming] = queue.pop();
    let produced = incoming;
    if (visited.has(id)) {
      const seen = visited.get(id);
      if ([...seen].every((k) => produced.has(k))) continue;
      produced = new Set([...produced].filter((k) => seen.has(k)));
    }
    visited.set(id, produced);

    const node = steps.get(id);
    if (!node) continue;
    if (id !== beginId) {
      for (const descriptor of consumedInputs(node)) {
        const key = `${id}.${descriptor.title}`;
        if (produced.has(key)) continue;
        if (Object.hasOwn(descriptor, "default")) continue;
        if (startTitles.has(descriptor.title)) continue;
        violations.push(key);
      }
    }

    const next = new Set(produced);
    for (const edge of flowDataEdges) if (edge.from === id) next.add(edge.key);
    for (const child of successors(id)) queue.push([child, new Set(next)]);
  }
  return violations;
}

test("every required step input has a source on every path that reaches it", () => {
  const found = unsourcedInputs();
  assert.deepEqual(
    found,
    [],
    "the runtime refuses to mount a flow whose step requires an input the StartStep does not carry: " + found.join(", "),
  );
});

// ---------------------------------------------------------------------------
// (B) an OutputMessageNode declares only inputs its template reads
// ---------------------------------------------------------------------------

test("an output message declares only inputs its template reads", () => {
  const offenders = [];
  for (const node of nodesOfType("OutputMessageNode")) {
    const rendered = outsideComment(node.message);
    for (const { title } of node.inputs ?? []) {
      if (!new RegExp(`\\b${title}\\b`).test(rendered)) offenders.push(`${node.id}.${title}`);
    }
  }
  assert.deepEqual(offenders, [], "the runtime rejects an input the template never reads: " + offenders.join(", "));
});

// ---------------------------------------------------------------------------
// (C) every declared default fits its declared type
// ---------------------------------------------------------------------------

/** Whether a default fits a declared JSON schema type, by the rule the
 *  runtime's spec loader applies at mount: null only where the type carries
 *  "null", an object only a plain object, an array only a list, a string only a
 *  string, and the numeric types (number, integer, boolean) a number or a
 *  boolean. A type written as a list is read as any of its members. */
function defaultFitsType(value, type) {
  if (Array.isArray(type)) return type.some((member) => defaultFitsType(value, member));
  if (value === null) return type === "null";
  switch (type) {
    case "object":
      return typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
    case "boolean":
      return typeof value === "number" || typeof value === "boolean";
    default:
      return false;
  }
}

test("(19) every declared default fits its declared type", () => {
  assert.ok(nodesOfType("OutputMessageNode").length > 0, "the flow has no closing statement to check");
  const misfits = [];
  const check = (owner, descriptors) => {
    for (const d of descriptors ?? []) {
      if (!Object.hasOwn(d, "default") || d.type === undefined) continue;
      if (!defaultFitsType(d.default, d.type)) misfits.push(`${owner}.${d.title}`);
    }
  };
  check(oas.id, oas.inputs);
  check(oas.id, oas.outputs);
  for (const [id, component] of Object.entries(refs)) {
    check(id, component.outputs);
    // The runtime's loader drops a gate's declared inputs before the load.
    if (component.component_type !== "InputMessageNode") check(id, component.inputs);
  }
  assert.deepEqual(
    misfits,
    [],
    "the runtime refuses a default its declared type does not allow: " + misfits.join(", "),
  );

  const message = String(refs.delivery_summary?.message ?? "");
  assert.ok(message.indexOf("{% if status == 'completed' %}") >= 0, "the closing sentence does not test the send's status first");
});
