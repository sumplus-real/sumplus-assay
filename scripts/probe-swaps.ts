import { blockNumber, traffic } from "../lib/rpc";
import { recentSwaps } from "../lib/onchain";

/** How far back do we have to look before this pair has enough trades to say anything? */
(async () => {
  const head = await blockNumber();
  const CHUNK = 4000;
  let found = 0;
  let scanned = 0;
  const all: number[] = [];
  for (let i = 0; i < 40 && found < 60; i += 1) {
    const to = head - i * CHUNK;
    const from = to - CHUNK;
    try {
      const swaps = await recentSwaps(from, to);
      scanned += CHUNK;
      found += swaps.length;
      if (swaps.length) {
        all.push(...swaps.map((s) => s.price));
        console.log(`blocks ${from}..${to}  ${swaps.length} swaps  prices ${Math.min(...swaps.map((s) => s.price)).toFixed(2)}..${Math.max(...swaps.map((s) => s.price)).toFixed(2)}`);
      }
    } catch (e) {
      console.log(`blocks ${from}..${to}  FAILED ${String(e).slice(0, 80)}`);
      break;
    }
  }
  const hours = (scanned * 0.75) / 3600;
  console.log(`\n${found} swaps across ${scanned} blocks (~${hours.toFixed(1)} hours), ${traffic.calls} rpc calls`);
  if (all.length) console.log(`price range overall ${Math.min(...all).toFixed(2)} .. ${Math.max(...all).toFixed(2)}`);
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
