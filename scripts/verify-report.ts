/**
 * Check a published report against the chain, using nothing the report says
 * about itself.
 *
 * Three questions, in order of how much they are worth:
 *   1. Does each assay still hash to the value that was anchored for it?
 *   2. Does the anchor for that hash actually exist on chain, in a block?
 *   3. Does the contract's stored head match the head rebuilt from its anchors?
 *
 * Every hash is recomputed here. Nothing stored in the file is carried forward
 * as an assumption, which is the only way this is a check rather than a recital.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical } from "../lib/report";
import { assayHash, onChainHead, anchorAt, ASSAY_ANCHOR } from "../lib/anchor";
import { verify } from "../lib/receipts";
import { explorerTx } from "../lib/rpc";

const path = process.argv[2] ?? join(import.meta.dirname, "..", "data", "report.json");
const report = JSON.parse(readFileSync(path, "utf8"));

let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
};
const pass = (msg: string) => console.log(`  ok    ${msg}`);

(async () => {
  console.log(`Verifying ${path}`);
  console.log(`Anchor contract ${ASSAY_ANCHOR} on chain ${report.chainId}`);

  // Read every anchor once, up front, so each assay is looked up by content.
  const live = await onChainHead();
  const anchors = [];
  for (let i = 0; i < live.count; i += 1) anchors.push(await anchorAt(i));
  console.log(`${anchors.length} anchors read from chain\n`);

  for (const run of report.runs) {
    const id = run.result.taskId;
    console.log(`${id} · ${run.result.category}`);

    // 1. The hash of the numbers, recomputed from the numbers.
    const recomputed = assayHash(canonical(run.result));
    if (recomputed === run.hash) pass(`assay hash recomputes to ${recomputed.slice(0, 18)}…`);
    else fail(`assay hash is ${run.hash} but the numbers hash to ${recomputed}`);

    // 2. The receipts inside the run, rebuilt rather than read.
    const v = verify(run.receipts);
    if (v.ok) pass(`${v.length} receipts, chain intact`);
    else fail(`receipt chain broken: ${v.problems.map((p) => `${p.kind} at ${p.seq}`).join(", ")}`);

    // 3. The anchor on chain for this assay, found by its hash.
    //
    // Deliberately a search rather than an index. Positions shift the moment
    // anything else is anchored, and an index that quietly points at the wrong
    // row would still find a hash and still print something reassuring.
    try {
      const hit = anchors.findIndex((a) => a.assayHash.toLowerCase() === recomputed.toLowerCase());
      if (hit < 0) {
        fail(`no anchor on chain carries ${recomputed}`);
      } else {
        pass(`anchor ${hit} of ${anchors.length} carries this hash · ${explorerTx(run.anchor.txHash)}`);
        if (anchors[hit].category !== run.result.category) {
          fail(`anchor ${hit} is filed under "${anchors[hit].category}", not "${run.result.category}"`);
        }
      }
    } catch (e) {
      fail(`could not read anchor from chain: ${e instanceof Error ? e.message : String(e)}`);
    }
    console.log("");
  }

  // 4. The head the contract stored, against the head it rebuilds on request.
  const head = await onChainHead();
  console.log(`chain head`);
  if (head.agree) pass(`stored and recomputed agree over ${head.count} anchors · ${head.stored.slice(0, 18)}…`);
  else fail(`stored ${head.stored} but recomputes to ${head.recomputed}`);

  console.log("");
  if (failures === 0) {
    console.log("Everything checks out.");
  } else {
    console.log(`${failures} check${failures === 1 ? "" : "s"} failed.`);
    process.exit(1);
  }
})().catch((e) => {
  console.error("verification could not complete:", e);
  process.exit(1);
});
