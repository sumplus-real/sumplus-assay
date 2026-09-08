import test from "node:test";
import assert from "node:assert/strict";

import { Ledger, verify } from "../lib/receipts";
import { judgeSpend, judgeTool, judgeHost, usd, DEFAULT_MANDATE } from "../lib/mandate";
import { estimateTokens, parseAnswer, runAgent } from "../lib/agent";
import { measureAssay } from "../lib/report";

function chainOfThree() {
  const ledger = new Ledger();
  ledger.append({ step: "one", detail: "a", decision: "allowed", reason: "first", payload: { i: 1 } });
  ledger.append({ step: "two", detail: "b", decision: "allowed", reason: "second", payload: { i: 2 } });
  ledger.append({ step: "three", detail: "c", decision: "allowed", reason: "third", payload: { i: 3 } });
  return ledger;
}

test("a genuine chain verifies", () => {
  const v = verify(chainOfThree().receipts);
  assert.equal(v.ok, true);
  assert.equal(v.problems.length, 0);
});

test("editing one receipt is caught twice: its own hash, and the next receipt's link", () => {
  const receipts = chainOfThree().receipts.map((r) => ({ ...r }));
  receipts[1].reason = "second, but improved afterwards";

  const v = verify(receipts);
  assert.equal(v.ok, false);

  const kinds = new Set(v.problems.map((p) => p.kind));
  // Both halves matter. Asserting only the first would pass even if the links
  // were never checked at all.
  assert.ok(kinds.has("hash-mismatch"), "the edited receipt's own hash was not recomputed");
  assert.ok(kinds.has("broken-link"), "the receipt after the edited one still linked cleanly");

  assert.ok(v.problems.some((p) => p.seq === 1 && p.kind === "hash-mismatch"));
  assert.ok(v.problems.some((p) => p.seq === 2 && p.kind === "broken-link"));
});

test("dropping a receipt from the middle does not go unnoticed", () => {
  const receipts = chainOfThree().receipts.filter((r) => r.seq !== 1);
  const v = verify(receipts);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => p.kind === "bad-sequence" || p.kind === "broken-link"));
});

test("a ceiling of zero stops the run rather than meaning no ceiling", () => {
  const stopped = { ...DEFAULT_MANDATE, perTaskCeilingMicroUsd: 0 };
  const ruling = judgeSpend(stopped, 0, 1);
  assert.equal(ruling.decision, "refused");
  assert.match(ruling.reason, /ceiling/);
});

test("a tool outside the list is refused with a sentence", () => {
  const ruling = judgeTool(DEFAULT_MANDATE, "transfer_everything", 0);
  assert.equal(ruling.decision, "refused");
  assert.ok(ruling.reason.trim().endsWith("."), "a refusal must carry a sentence");
});

test("the call budget is a real limit", () => {
  const ruling = judgeTool(DEFAULT_MANDATE, "pool_state", DEFAULT_MANDATE.maxToolCalls);
  assert.equal(ruling.decision, "refused");
});

test("a host outside the allowlist is refused before the request", () => {
  assert.equal(judgeHost(DEFAULT_MANDATE, "https://example.invalid/x").decision, "refused");
  assert.equal(judgeHost(DEFAULT_MANDATE, "https://router.sumplus.xyz/v1").decision, "allowed");
});

test("a displayed cost always reads back as at least the real one", () => {
  for (const micro of [1, 6, 60, 600, 6000, 12345, 999999, 1_000_000]) {
    const shown = Number(usd(micro).slice(1));
    assert.ok(shown * 1_000_000 >= micro - 1e-6, `${usd(micro)} is below ${micro} micro-dollars`);
  }
  assert.equal(usd(6000), "$0.006");
});

test("the token estimate is an over-count, not a guess in either direction", () => {
  const text = "x".repeat(1200);
  // Four characters per token is the usual rule of thumb; ours must be larger.
  assert.ok(estimateTokens(text) > text.length / 4);
});

test("a response with no usage block is never priced at zero", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: '{"price": 1}' } }] }), // no usage
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;
  try {
    const run = await runAgent("a question", ["price"], {
      baseUrl: "https://router.sumplus.xyz/v1",
      apiKey: "test",
      model: "gemini-2.5-flash-lite",
      inputPerMillion: 0.1,
      outputPerMillion: 0.4,
    });
    assert.equal(run.usageReported, false, "a missing usage block must be flagged");
    assert.ok(run.moneyMicroUsd > 0, "a run with no usage block was priced at zero");
    assert.ok(run.promptTokens > 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("an answer survives being wrapped in a fence or in prose", () => {
  assert.deepEqual(parseAnswer('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseAnswer('Here you go: {"a":2} hope that helps'), { a: 2 });
  assert.deepEqual(parseAnswer("no json at all"), {});
});

test("the crossover is the rate at which the verdict flips, not decoration", () => {
  const result = measureAssay({
    taskId: "t",
    category: "yield",
    title: "t",
    question: "q",
    reference: { a: 1 },
    manual: { label: "manual", ms: 1000, lookups: 150, rpcCalls: 322, moneyMicroUsd: 0, score: 1, answer: { a: 1 }, notes: [] },
    agent: { label: "agent", ms: 15000, lookups: 3, rpcCalls: 60, moneyMicroUsd: 2000, score: 1, answer: { a: 1 }, notes: [] },
    secondsPerLookup: 20,
  });
  // 150 lookups at the crossover rate must take exactly as long as the agent did.
  const atCrossover = result.manual.lookups * result.derived.crossoverSecondsPerLookup;
  assert.ok(Math.abs(atCrossover - result.derived.agentSeconds) < 1e-9);
  assert.ok(result.derived.fasterBy > 1);
});
