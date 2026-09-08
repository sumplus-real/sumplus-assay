import { allMarkets, marketDetail, VENUS_COMPTROLLER } from "../lib/onchain";
import { traffic } from "../lib/rpc";

(async () => {
  const markets = await allMarkets();
  const details = (await Promise.all(markets.map(marketDetail))).filter(Boolean);
  const rows = details as NonNullable<(typeof details)[number]>[];

  rows.sort((a, b) => b.cash - a.cash);
  console.log("comptroller", VENUS_COMPTROLLER, "markets", rows.length, "of", markets.length, "listed\n");
  console.log("symbol      vToken                                     cash        borrows     util%   supplyAPY  borrowAPY  cf");
  for (const m of rows) {
    console.log(
      `${m.symbol.padEnd(11)} ${m.vToken} ${m.cash.toFixed(4).padStart(11)} ${m.borrows
        .toFixed(4)
        .padStart(11)} ${m.utilisation.toFixed(1).padStart(6)} ${m.supplyApy.toFixed(2).padStart(10)} ${m.borrowApy
        .toFixed(2)
        .padStart(10)}  ${m.collateralFactor}`
    );
  }
  console.log(`\n${traffic.calls} rpc calls, ${traffic.retries} retries`);
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
