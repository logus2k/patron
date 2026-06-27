// Node tests for the draft compiler (js/compile.js). No browser/litegraph needed:
// the compiler is pure and operates on a serialized-graph object.
//   node test/compile.test.mjs
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import assert from "assert";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { compile } = require("../js/compile.js");

const checks = [];
const run = (name, fn) => {
  try { fn(); checks.push([name, true]); }
  catch (e) { checks.push([name, false, e.message]); }
};

const newsGraph = JSON.parse(readFileSync(join(here, "../examples/news-agent.graph.json"), "utf8"));

run("News Agent graph compiles to the expected v0 flat record", () => {
  const out = compile(newsGraph);
  assert.strictEqual(out.ok, true, "expected ok:true, got " + JSON.stringify(out.errors));
  assert.deepStrictEqual(out.dsl, {
    version: "0.1",
    id: "news-morning-ai",
    trigger: { type: "schedule" },
    brain: { persona: "news_curator", llm: { temperature: 0.3, max_tokens: 1024 } },
    tools: { server: "noted", allow: ["noted__newsapi_search", "noted__fetch_url"], max_rounds: 3 },
    input: { template: "Curate the {n} best morning headlines about {topic}.", vars: { n: 5, topic: "AI agents" } },
    delivery: { channel: "whatsapp", target: "351961050313@c.us" },
  });
});

run("a Bus destination lowers channel=bus; rag/tools/guardrail omitted when absent", () => {
  const minimal = {
    nodes: [
      { type: "patron/agent/trigger", properties: { agent_id: "x", trigger_type: "schedule" } },
      { type: "patron/agent/brain", properties: { persona: "p", temperature: 0.5, max_tokens: 256, input_template: "t", input_vars: "{}" } },
      { type: "patron/dest/bus", properties: { target: "ops" } },
    ],
  };
  const out = compile(minimal);
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(out.dsl.delivery, { channel: "bus", target: "ops" });
  assert.ok(!("tools" in out.dsl) && !("rag" in out.dsl) && !("guardrails" in out.dsl));
});

run("missing required Brain node -> ok:false", () => {
  const out = compile({ nodes: [
    { type: "patron/agent/trigger", properties: {} },
    { type: "patron/dest/whatsapp", properties: {} },
  ] });
  assert.strictEqual(out.ok, false);
  assert.ok(out.errors.some((e) => /Brain/.test(e)), "errors: " + JSON.stringify(out.errors));
});

run("missing destination block -> ok:false", () => {
  const out = compile({ nodes: [
    { type: "patron/agent/trigger", properties: {} },
    { type: "patron/agent/brain", properties: { input_vars: "{}" } },
  ] });
  assert.strictEqual(out.ok, false);
  assert.ok(out.errors.some((e) => /destination/.test(e)));
});

run("more than one destination -> ok:false", () => {
  const out = compile({ nodes: [
    { type: "patron/agent/trigger", properties: {} },
    { type: "patron/agent/brain", properties: { input_vars: "{}" } },
    { type: "patron/dest/whatsapp", properties: {} },
    { type: "patron/dest/tts", properties: {} },
  ] });
  assert.strictEqual(out.ok, false);
  assert.ok(out.errors.some((e) => /one destination/.test(e)));
});

run("invalid input_vars JSON -> ok:false", () => {
  const out = compile({ nodes: [
    { type: "patron/agent/trigger", properties: {} },
    { type: "patron/agent/brain", properties: { input_vars: "{not json}" } },
    { type: "patron/dest/whatsapp", properties: {} },
  ] });
  assert.strictEqual(out.ok, false);
  assert.ok(out.errors.some((e) => /input_vars/.test(e)));
});

let ok = true;
console.log("=== Patron compiler tests ===");
for (const [n, p, err] of checks) {
  console.log(`  [${p ? "PASS" : "FAIL"}] ${n}` + (err ? `  -> ${err}` : ""));
  ok = ok && p;
}
console.log("\nRESULT:", ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
