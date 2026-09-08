import { TASKS } from "../lib/tasks";
import { traffic } from "../lib/rpc";

/** Run every task's manual path and print the reference answers it produces. */
(async () => {
  for (const task of TASKS) {
    traffic.reset();
    const steps = await task.manualSteps();
    const ref = await task.reference();
    console.log(`\n=== ${task.category} · ${task.id} ===`);
    console.log(task.title);
    console.log(`manual path: ${steps.length} discrete lookups`);
    console.log(`reference run: ${ref.ms} ms, ${ref.rpcCalls} rpc calls`);
    for (const [k, v] of Object.entries(ref.answer)) console.log(`  ${k}: ${v}`);
  }
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
