import { Interface, formatUnits } from "ethers";
import { allMarkets, marketDetail, VENUS_COMPTROLLER } from "../lib/onchain";
import { ethCall } from "../lib/rpc";

const comp = new Interface([
  "function borrowCaps(address) view returns (uint256)",
  "function actionPaused(address,uint8) view returns (bool)",
]);

/** Which markets have room left under their borrow cap, and cash to lend? */
(async () => {
  const markets = await allMarkets();
  const rows = (await Promise.all(markets.map(marketDetail))).filter(Boolean) as NonNullable<
    Awaited<ReturnType<typeof marketDetail>>
  >[];

  const out: Array<{ symbol: string; vToken: string; cash: number; borrows: number; cap: number; headroom: number; paused: boolean }> = [];
  for (const m of rows) {
    if (m.cash <= 0) continue;
    try {
      const capRaw = comp.decodeFunctionResult(
        "borrowCaps",
        await ethCall(VENUS_COMPTROLLER, comp.encodeFunctionData("borrowCaps", [m.vToken]))
      )[0] as bigint;
      const pausedRaw = comp.decodeFunctionResult(
        "actionPaused",
        await ethCall(VENUS_COMPTROLLER, comp.encodeFunctionData("actionPaused", [m.vToken, 2]))
      )[0] as boolean;
      const cap = Number(formatUnits(capRaw, 18));
      // A cap of zero means unlimited in this protocol, not "nothing allowed".
      const headroom = cap === 0 ? Infinity : cap - m.borrows;
      out.push({ symbol: m.symbol, vToken: m.vToken, cash: m.cash, borrows: m.borrows, cap, headroom, paused: pausedRaw });
    } catch {
      /* market that does not answer is not usable */
    }
  }

  out.sort((a, b) => Math.min(b.headroom, b.cash) - Math.min(a.headroom, a.cash));
  console.log("symbol       cash            borrows         cap             headroom        paused");
  for (const r of out.slice(0, 18)) {
    console.log(
      `${r.symbol.padEnd(12)} ${r.cash.toFixed(2).padStart(15)} ${r.borrows.toFixed(2).padStart(15)} ${(r.cap === 0 ? "unlimited" : r.cap.toFixed(2)).padStart(15)} ${(r.headroom === Infinity ? "unlimited" : r.headroom.toFixed(2)).padStart(15)}  ${r.paused}`
    );
  }
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
