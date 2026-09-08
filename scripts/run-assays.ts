/**
 * Run every assay: the manual path, the agent path, the comparison, and the
 * anchor. Writes the finished report to disk for the site to read.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { TASKS, type Task } from "../lib/tasks";
import { traffic } from "../lib/rpc";
import { modelFromEnv, runAgent } from "../lib/agent";
import { measureAssay, canonical, render, type AssayResult } from "../lib/report";
import { anchor, assayHash, onChainHead, ASSAY_ANCHOR } from "../lib/anchor";
import { verify } from "../lib/receipts";

const OUT_DIR = join(process.cwd(), "data");
const ANCHOR_ON_CHAIN = process.env.ANCHOR !== "0";

async function runOne(task: Task, config: ReturnType<typeof modelFromEnv>) {
  traffic.reset();
  const steps = await task.manualSteps();
  const manualRpcBefore = traffic.calls;
  const reference = await task.reference();

  const fields = Object.keys(reference.answer);
  const agent = await runAgent(task.question, fields, config);
  const scoring = task.score(agent.answer, reference.answer);
  const chain = verify(agent.ledger.receipts);

  const result = measureAssay({
    taskId: task.id,
    category: task.category,
    title: task.title,
    question: task.question,
    reference: reference.answer,
    manual: {
      label: "manual",
      ms: reference.ms,
      lookups: steps.length,
      rpcCalls: reference.rpcCalls + (traffic.calls - manualRpcBefore - reference.rpcCalls > 0 ? 0 : 0),
      moneyMicroUsd: 0,
      score: 1,
      answer: reference.answer,
      notes: [],
    },
    agent: {
      label: "agent",
      ms: agent.ms,
      lookups: agent.toolCalls,
      rpcCalls: agent.rpcCalls,
      moneyMicroUsd: agent.moneyMicroUsd,
      score: scoring.score,
      answer: agent.answer,
      notes: scoring.notes,
    },
  });

  return {
    result,
    steps,
    receipts: agent.ledger.receipts,
    chain,
    usageReported: agent.usageReported,
    tokens: { prompt: agent.promptTokens, completion: agent.completionTokens },
  };
}

(async () => {
  const config = modelFromEnv();
  console.log(`model ${config.model} on the ${config.provider} line, ${config.inputPerMillion}/${config.outputPerMillion} per million\n`);

  const runs: Array<Awaited<ReturnType<typeof runOne>> & { anchor?: unknown; hash: string }> = [];

  for (const task of TASKS) {
    process.stdout.write(`running ${task.category}… `);
    const one = await runOne(task, config);
    const hash = assayHash(canonical(one.result));
    let anchored: unknown;
    if (ANCHOR_ON_CHAIN) {
      const key = process.env.PRIVATE_KEY;
      if (!key) throw new Error("PRIVATE_KEY is not set, so the assay cannot be anchored.");
      anchored = await anchor(key, hash, task.category);
    }
    runs.push({ ...one, hash, anchor: anchored });
    console.log("done");
  }

  console.log("");
  for (const run of runs) {
    console.log(render(run.result));
    console.log(`  chain: ${run.chain.ok ? "intact" : "BROKEN"}, ${run.chain.length} receipts`);
    if (!run.usageReported) console.log("  cost is an upper-bound estimate: the gateway did not report usage");
    const a = run.anchor as { txHash?: string } | undefined;
    if (a?.txHash) console.log(`  anchored: ${a.txHash}`);
    console.log("");
  }

  const head = await onChainHead();
  console.log(`on-chain anchors: ${head.count}, head ${head.stored.slice(0, 18)}…`);
  console.log(`recomputed on chain: ${head.agree ? "agrees" : "DISAGREES"}`);

  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    model: { id: config.model, provider: config.provider, inputPerMillion: config.inputPerMillion, outputPerMillion: config.outputPerMillion },
    contract: ASSAY_ANCHOR,
    chainId: 97,
    onChain: head,
    runs: runs.map((r) => ({
      hash: r.hash,
      anchor: r.anchor,
      usageReported: r.usageReported,
      tokens: r.tokens,
      chainOk: r.chain.ok,
      receipts: r.receipts,
      manualSteps: r.steps,
      result: r.result,
    })),
  };
  // A second run writes beside the first rather than over it. Replacing the
  // published report with a fresher one would quietly destroy the thing that
  // makes a repeat run worth anything: two independent runs to compare.
  const name = process.argv[2] ?? "report.json";
  writeFileSync(join(OUT_DIR, name), JSON.stringify(payload, null, 2));
  console.log(`\nwrote data/${name}`);
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
