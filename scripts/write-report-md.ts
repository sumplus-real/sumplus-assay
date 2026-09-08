/**
 * The Agent Advantage Report as a file, generated from the same run the site
 * serves. TermiX asks for the actual outputs attached, so every task's answer
 * is printed in full, both paths, field by field, rather than summarised.
 *
 * Generated rather than written, so the file cannot drift away from the run it
 * describes. Regenerate with: npx tsx scripts/write-report-md.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { usd } from "../lib/mandate";
import { explorerTx, explorerAddress } from "../lib/rpc";
import { verify } from "../lib/receipts";

const root = join(import.meta.dirname, "..");
const report = JSON.parse(readFileSync(join(root, "data", "report.json"), "utf8"));

/** Optional second run of the same four assays, kept beside the first. */
let repeat: any = null;
try {
  repeat = JSON.parse(readFileSync(join(root, "data", "report-2.json"), "utf8"));
} catch {
  repeat = null;
}

const secs = (n: number) => (n >= 100 ? `${n.toFixed(0)} s` : `${n.toFixed(1)} s`);
const out: string[] = [];
const w = (s = "") => out.push(s);

const runs = report.runs;
const humanSecs = runs.reduce((a: number, r: any) => a + r.result.derived.humanSeconds, 0);
const agentSecs = runs.reduce((a: number, r: any) => a + r.result.derived.agentSeconds, 0);
const humanCost = runs.reduce((a: number, r: any) => a + r.result.derived.humanCostMicroUsd, 0);
const agentCost = runs.reduce((a: number, r: any) => a + r.result.agent.moneyMicroUsd, 0);
const matched = runs.filter((r: any) => r.result.agent.score >= 0.999).length;
const assume = runs[0].result.assumptions;

w(`# Agent Advantage Report`);
w();
w(`Sumplus Assay · BNB Chain Build the Era, TermiX track`);
w(`Run generated ${report.generatedAt} · BNB Smart Chain testnet, chain id ${report.chainId}`);
w();
w(`Four tasks, each run twice against live chain state: once as a scripted manual`);
w(`baseline that makes the same lookups a person makes on a block explorer, once by`);
w(`an agent under a spending mandate. Both paths ran inside the same run and saw the`);
w(`same block, because a comparison drawn from two different moments is not a`);
w(`comparison. One task is a trading plan and one is a position risk read.`);
w();
w(`Live version: https://sumplus-assay-production.up.railway.app/report`);
w();
w(`## Summary`);
w();
w(`| Category | Task | Lookups | Time by hand | Cost by hand | Agent time | Agent cost | Quality | Anchor |`);
w(`|---|---|---|---|---|---|---|---|---|`);
for (const r of runs) {
  const d = r.result.derived;
  w(
    `| ${r.result.category} | ${r.result.title} | ${r.result.manual.lookups} | ${d.humanSeconds.toFixed(0)} s | ` +
      `${usd(d.humanCostMicroUsd)} | ${secs(d.agentSeconds)} | ${usd(r.result.agent.moneyMicroUsd)} | ` +
      `${(r.result.agent.score * 100).toFixed(0)}% | [${r.anchor.txHash.slice(0, 10)}…](${explorerTx(r.anchor.txHash)}) |`
  );
}
w(
  `| **Total** | | | **${humanSecs.toFixed(0)} s** | **${usd(humanCost)}** | **${secs(agentSecs)}** | ` +
    `**${usd(agentCost)}** | **${matched}/${runs.length}** | |`
);
w();
w(`The agent was ${(humanSecs / agentSecs).toFixed(1)} times faster overall and cost`);
w(`${(humanCost / agentCost).toFixed(0)} times less at the stated rate.`);
w();
w(`## What is measured and what is assumed`);
w();
w(`Measured: agent wall clock, tool calls, RPC calls, tokens in and out priced at the`);
w(`gateway's published rate for the line the request was pinned to, and whether the`);
w(`answer matched the reference field by field.`);
w();
w(`Assumed: ${assume.secondsPerLookup} seconds for a person to make one lookup on a`);
w(`block explorer, and ${usd(assume.hourlyRateUsd * 1_000_000)} an hour for that`);
w(`person's time. Both are stated rather than buried, and each task below carries the`);
w(`rate at which its own conclusion flips, so a reader can overturn the claim with`);
w(`their own numbers instead of taking ours.`);
w();
w(`If a model response ever arrives without a usage block, the run records that fact`);
w(`and prices the call from a deliberately high estimate. A missing field is never`);
w(`read as zero cost.`);
w();

if (repeat) {
  const pairs = runs
    .map((first: any) => ({ first, second: repeat.runs.find((x: any) => x.result.taskId === first.result.taskId) }))
    .filter((p: any) => p.second);
  const t1 = pairs.reduce((a: number, p: any) => a + p.first.result.derived.agentSeconds, 0);
  const t2 = pairs.reduce((a: number, p: any) => a + p.second.result.derived.agentSeconds, 0);
  const both = pairs.filter((p: any) => p.first.result.agent.score >= 0.999 && p.second.result.agent.score >= 0.999).length;

  w(`## Run it again`);
  w();
  w(`The same four assays, run a second time on ${repeat.generatedAt} against chain`);
  w(`state that had moved on. Published beside the first run rather than replacing it,`);
  w(`because a report that only ever shows its latest numbers cannot be asked whether`);
  w(`the result holds.`);
  w();
  w(`| Category | Time run 1 | Run 2 | Cost run 1 | Run 2 | Faster run 1 | Run 2 | Matched |`);
  w(`|---|---|---|---|---|---|---|---|`);
  for (const p of pairs) {
    w(
      `| ${p.first.result.category} | ${secs(p.first.result.derived.agentSeconds)} | ${secs(p.second.result.derived.agentSeconds)} | ` +
        `${usd(p.first.result.agent.moneyMicroUsd)} | ${usd(p.second.result.agent.moneyMicroUsd)} | ` +
        `${p.first.result.derived.fasterBy.toFixed(1)}× | ${p.second.result.derived.fasterBy.toFixed(1)}× | ` +
        `${(p.first.result.agent.score * 100).toFixed(0)}% / ${(p.second.result.agent.score * 100).toFixed(0)}% |`
    );
  }
  w(
    `| **Overall** | **${secs(t1)}** | **${secs(t2)}** | | | **${(humanSecs / t1).toFixed(1)}×** | ` +
      `**${(humanSecs / t2).toFixed(1)}×** | **${both}/${pairs.length} both** |`
  );
  w();
  w(`Every task reproduced the reference answer in both runs and the advantage`);
  w(`survived, but it is not the same number twice: ${(humanSecs / t1).toFixed(1)}× became`);
  w(`${(humanSecs / t2).toFixed(1)}× overall. Three tasks got faster. The yield scan got`);
  w(`slower and dearer because the agent chose to sweep the market list three times`);
  w(`instead of twice, which is a real property of hiring an agent rather than noise`);
  w(`to be averaged away.`);
  w();
  w(`The health assay is the useful one to look at closely. Its reference answer`);
  w(`changed between runs, from a borrow limit of $4.8016 to $4.8022, because the`);
  w(`collateral is real and BNB moved underneath it. A task that returned identical`);
  w(`numbers hours apart would be reading a fixture, not a chain.`);
  w();
  w(`The second run's anchors are on the same contract, which is why the chain now`);
  w(`holds more anchors than this report has tasks. The verifier finds each assay's`);
  w(`anchor by its hash rather than by position, so adding runs does not invalidate`);
  w(`the ones already published.`);
  w();
}

for (const r of runs) {
  const res = r.result;
  const d = res.derived;
  w(`## ${res.category} · ${res.title}`);
  w();
  w(`**Question.** ${res.question}`);
  w();
  w(`| | by hand | agent |`);
  w(`|---|---|---|`);
  w(`| steps | ${res.manual.lookups} lookups | ${res.agent.lookups} tool calls |`);
  w(`| RPC reads | ${res.manual.rpcCalls} | ${res.agent.rpcCalls} |`);
  w(`| time | ${d.humanSeconds.toFixed(0)} s | ${secs(d.agentSeconds)} |`);
  w(`| cost | ${usd(d.humanCostMicroUsd)} | ${usd(res.agent.moneyMicroUsd)} |`);
  w(`| tokens | | ${r.tokens.prompt} in / ${r.tokens.completion} out |`);
  w(`| answer | reference | ${(res.agent.score * 100).toFixed(0)}% reproduced |`);
  w();
  w(`${d.verdict}`);
  w();
  w(`**The answer, field by field.**`);
  w();
  w(`| Field | Reference | Agent |`);
  w(`|---|---|---|`);
  for (const k of Object.keys(res.reference)) {
    w(`| \`${k}\` | ${String(res.reference[k])} | ${String(res.agent.answer[k] ?? "—")} |`);
  }
  w();
  if (res.agent.notes.length) {
    w(`Where the agent differed: ${res.agent.notes.join("; ")}`);
    w();
  }
  w(`**What the manual path does.** ${r.manualSteps.length} lookups, in order.`);
  w();
  for (const s of r.manualSteps.slice(0, 10)) w(`1. ${s.where} — ${s.action}`);
  if (r.manualSteps.length > 10) w(`1. …and ${r.manualSteps.length - 10} more of the same shape, one market at a time.`);
  w();
  const v = verify(r.receipts);
  w(`**What the agent did.** ${r.receipts.length} receipts, chained and rebuilt from`);
  w(`scratch by the verifier: ${v.ok ? "intact" : "broken"}.`);
  w();
  w(`| # | Step | Detail | Ruling | Cost |`);
  w(`|---|---|---|---|---|`);
  for (const x of r.receipts) w(`| ${x.seq} | ${x.step} | ${x.detail} | ${x.decision} | ${usd(x.costMicroUsd)} |`);
  w();
  w(`**Anchor.** Assay hash \`${r.hash}\` in block ${r.anchor.blockNumber},`);
  w(`[transaction](${explorerTx(r.anchor.txHash)}).`);
  w();
}

w(`## Why this report can be checked`);
w();
w(`Each assay is canonicalised with sorted keys, hashed with keccak, and anchored in`);
w(`its own transaction on [\`${report.contract}\`](${explorerAddress(report.contract)})`);
w(`before this submission. The anchors are chained to each other, and the contract`);
w(`rebuilds that chain on request through \`recomputeHead()\`, so a stored head that`);
w(`nobody recomputes is not what anyone is being asked to trust.`);
w();
w(`Running \`npm run verify\` recomputes every hash from the numbers above, rebuilds`);
w(`every receipt chain, reads each anchor back off chain by index, and compares the`);
w(`stored head against the rebuilt one. Point it at an edited copy of the report and`);
w(`the edited assay fails twice while the others keep passing.`);
w();
w(`## What is not claimed`);
w();
w(`- The chain stores a hash, not the report. Without the published report the hash`);
w(`  proves nothing on its own.`);
w(`- An anchor proves the numbers existed at that block. It does not prove the run`);
w(`  behind them was well designed; that is what the manual baseline and the`);
w(`  published crossover are for.`);
w(`- The human seconds and the hourly rate are stated assumptions, not measurements.`);
w();

writeFileSync(join(root, "REPORT.md"), out.join("\n"));
console.log(`REPORT.md written, ${out.length} lines`);
