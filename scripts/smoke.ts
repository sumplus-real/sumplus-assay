import { blockNumber, traffic, gasPrice } from "../lib/rpc";
import { poolState, recentSwaps, allMarkets, marketDetail } from "../lib/onchain";

(async () => {
  const t0 = Date.now();
  const bn = await blockNumber();
  console.log("block", bn, "gasPrice", (Number(await gasPrice()) / 1e9).toFixed(3), "gwei");

  const pool = await poolState();
  console.log(
    "pool",
    pool.pair,
    `${pool.reserveBusd.toFixed(2)} BUSD / ${pool.reserveWbnb.toFixed(4)} WBNB`,
    "price",
    pool.price.toFixed(4)
  );

  const swaps = await recentSwaps(bn - 4000, bn);
  console.log("swaps in last 4000 blocks:", swaps.length);
  if (swaps.length) {
    const prices = swaps.map((s) => s.price);
    console.log("  price range", Math.min(...prices).toFixed(4), "to", Math.max(...prices).toFixed(4));
    console.log(
      "  first",
      swaps[0].block,
      swaps[0].price.toFixed(4),
      "last",
      swaps.at(-1)!.block,
      swaps.at(-1)!.price.toFixed(4)
    );
  }

  const markets = await allMarkets();
  console.log("venus markets listed:", markets.length);
  const details = (await Promise.all(markets.slice(0, 12).map(marketDetail))).filter(Boolean);
  for (const m of details.slice(0, 8)) {
    console.log(
      `  ${m!.symbol.padEnd(10)} supply ${m!.supplyApy.toFixed(2)}%  borrow ${m!.borrowApy.toFixed(2)}%  util ${m!.utilisation.toFixed(1)}%  cf ${m!.collateralFactor}`
    );
  }
  console.log(`\n${traffic.calls} rpc calls, ${traffic.retries} retries, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
