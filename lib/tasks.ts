/**
 * The four tasks an assay runs, one per category BNB Chain names.
 *
 * Each task carries two things: the sequence of discrete lookups a person
 * performs to answer it without an agent, and the code that performs those same
 * lookups to produce the reference answer.
 *
 * The manual path is correct by construction, because it is the reference. What
 * it costs is the point. The agent is then scored on whether it reached the
 * same answer, and on what its own run cost.
 */

import { Interface, formatUnits } from "ethers";
import { blockNumber, ethCall, traffic } from "./rpc";
import {
  PANCAKE_V2_FACTORY,
  PAIR_BUSD_WBNB,
  VENUS_COMPTROLLER,
  WBNB,
  BUSD,
  allMarkets,
  marketDetail,
  poolState,
  recentSwaps,
} from "./onchain";

export type Answer = Record<string, number | string | boolean>;

/** One thing a person does by hand: open a page, read a value, do a sum. */
export type ManualStep = { where: string; action: string };

export type Reference = { answer: Answer; ms: number; rpcCalls: number };

export type Scoring = { score: number; notes: string[] };

export type Task = {
  id: string;
  category: "monitoring" | "grid" | "health" | "yield";
  title: string;
  /** What the agent is asked, in the words a person would use. */
  question: string;
  manualSteps: () => Promise<ManualStep[]>;
  reference: () => Promise<Reference>;
  score: (agent: Answer, reference: Answer) => Scoring;
};

/** The account whose Venus position the health task watches. It is this project's own. */
export const WATCHED_ACCOUNT = "0x5B5183A1Dd146A178C641ABdAced49199A54daCE";
export const VBNB = "0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c";
export const VFDUSD = "0xF06e662a00796c122AaAE935EC4F0Be3F74f5636";
export const VUSDT = "0xb7526572FFE56AB9D7489838Bf2E18e3323b441A";

const comptrollerAbi = new Interface([
  "function getAccountLiquidity(address) view returns (uint256, uint256, uint256)",
  "function markets(address) view returns (bool, uint256, bool)",
  "function actionPaused(address,uint8) view returns (bool)",
]);
const vTokenAbi = new Interface([
  "function balanceOf(address) view returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
  "function borrowBalanceStored(address) view returns (uint256)",
]);

async function read(iface: Interface, to: string, fn: string, args: unknown[] = []) {
  return iface.decodeFunctionResult(fn, await ethCall(to, iface.encodeFunctionData(fn, args)));
}

/** Time a block of work and report how many round trips it took. */
async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number; rpcCalls: number }> {
  const before = traffic.calls;
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0, rpcCalls: traffic.calls - before };
}

const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= Math.abs(b) * tolerance;

// ------------------------------------------------------------------ 1. watch

const BAND_CENTRE = 440;
const BAND_WIDTH = 0.02;

export const monitoring: Task = {
  id: "pool-watch",
  category: "monitoring",
  title: "Is the pool inside its band, and is anyone still trading it",
  question:
    `On BNB Smart Chain testnet, look at the PancakeSwap v2 BUSD/WBNB pool. Report the current price in BUSD per WBNB, ` +
    `whether that price is within ${BAND_WIDTH * 100}% of ${BAND_CENTRE}, and how many trades the pool has seen in the last 4000 blocks.`,

  manualSteps: async () => [
    { where: `BscScan testnet, factory ${PANCAKE_V2_FACTORY}`, action: "open the contract, Read tab" },
    { where: "factory, getPair", action: `call getPair(${WBNB}, ${BUSD})` },
    { where: `pair ${PAIR_BUSD_WBNB}`, action: "open the pair contract" },
    { where: "pair, token0", action: "call token0 to learn which reserve is which" },
    { where: "pair, getReserves", action: "call getReserves and note both numbers" },
    { where: "a calculator", action: "divide both reserves by 1e18" },
    { where: "a calculator", action: "divide BUSD reserve by WBNB reserve to get the price" },
    { where: "a calculator", action: `check the price against ${BAND_CENTRE} plus or minus ${BAND_WIDTH * 100}%` },
    { where: "BscScan, pair Events tab", action: "filter Swap events over the last 4000 blocks and count them" },
  ],

  reference: async () => {
    const { value, ms, rpcCalls } = await timed(async () => {
      const head = await blockNumber();
      const pool = await poolState();
      const swaps = await recentSwaps(head - 4000, head);
      return {
        price: Number(pool.price.toFixed(4)),
        reserveBusd: Number(pool.reserveBusd.toFixed(4)),
        reserveWbnb: Number(pool.reserveWbnb.toFixed(6)),
        withinBand: Math.abs(pool.price - BAND_CENTRE) <= BAND_CENTRE * BAND_WIDTH,
        tradesLast4000Blocks: swaps.length,
      } satisfies Answer;
    });
    return { answer: value, ms, rpcCalls };
  },

  score: (agent, ref) => {
    const notes: string[] = [];
    let hits = 0;
    const total = 3;
    if (typeof agent.price === "number" && near(agent.price, ref.price as number, 0.005)) hits += 1;
    else notes.push(`price: said ${agent.price}, reference ${ref.price}`);
    if (agent.withinBand === ref.withinBand) hits += 1;
    else notes.push(`band: said ${agent.withinBand}, reference ${ref.withinBand}`);
    if (Number(agent.tradesLast4000Blocks) === ref.tradesLast4000Blocks) hits += 1;
    else notes.push(`trades: said ${agent.tradesLast4000Blocks}, reference ${ref.tradesLast4000Blocks}`);
    return { score: hits / total, notes };
  },
};

// ------------------------------------------------------------------- 2. grid

const GRID_LEVELS = 8;
const GRID_HALF_RANGE = 0.1;
const INVENTORY_WBNB = 2;
const POOL_FEE = 0.0025;

export const grid: Task = {
  id: "grid-plan",
  category: "grid",
  title: "What a grid on this pool would actually earn",
  question:
    `Using the current price of the PancakeSwap v2 BUSD/WBNB pool on BNB Smart Chain testnet, plan a ${GRID_LEVELS}-level grid ` +
    `spanning ${GRID_HALF_RANGE * 100}% either side of the price, for an inventory of ${INVENTORY_WBNB} WBNB. ` +
    `Levels are evenly spaced, so the spacing is the full range divided by ${GRID_LEVELS - 1}. The inventory is split evenly, ` +
    `so each level holds ${INVENTORY_WBNB}/${GRID_LEVELS} WBNB. One crossing buys at a level and sells at the next, ` +
    `so it earns the level size times the spacing, minus the pool's ${POOL_FEE * 100}% fee charged on the level's value at ` +
    `the current price, once on the way in and once on the way out. Report the spacing in BUSD, the WBNB at each level, ` +
    `the net BUSD from one crossing, and whether this pool trades often enough for the grid to be worth running.`,

  manualSteps: async () => [
    { where: `pair ${PAIR_BUSD_WBNB}`, action: "call getReserves and token0, as in the first task" },
    { where: "a calculator", action: "derive the current price" },
    { where: "a calculator", action: `take ${(1 - GRID_HALF_RANGE).toFixed(2)}x and ${(1 + GRID_HALF_RANGE).toFixed(2)}x the price for the range` },
    { where: "a calculator", action: `divide the range into ${GRID_LEVELS} levels and write each one out` },
    { where: "a calculator", action: `divide ${INVENTORY_WBNB} WBNB across the levels` },
    { where: "a calculator", action: `multiply one level's size by the spacing, then subtract the ${POOL_FEE * 100}% fee twice, once each way` },
    { where: "BscScan, pair Events tab", action: "count Swap events over the last 4000 blocks" },
    { where: "your own judgement", action: "decide whether that trade count can cross the grid often enough to pay" },
  ],

  reference: async () => {
    const { value, ms, rpcCalls } = await timed(async () => {
      const head = await blockNumber();
      const pool = await poolState();
      const swaps = await recentSwaps(head - 4000, head);

      const low = pool.price * (1 - GRID_HALF_RANGE);
      const high = pool.price * (1 + GRID_HALF_RANGE);
      const spacing = (high - low) / (GRID_LEVELS - 1);
      const perLevelWbnb = INVENTORY_WBNB / GRID_LEVELS;
      // One crossing buys at a level and sells at the next, paying the pool fee
      // on both legs.
      const gross = perLevelWbnb * spacing;
      const fees = perLevelWbnb * pool.price * POOL_FEE * 2;
      const net = gross - fees;

      return {
        price: Number(pool.price.toFixed(4)),
        lowerBound: Number(low.toFixed(4)),
        upperBound: Number(high.toFixed(4)),
        spacingBusd: Number(spacing.toFixed(4)),
        perLevelWbnb: Number(perLevelWbnb.toFixed(6)),
        netPerCrossingBusd: Number(net.toFixed(4)),
        tradesLast4000Blocks: swaps.length,
        // The honest half of the answer: a grid needs crossings, and this pool
        // is not producing them.
        worthRunning: swaps.length >= GRID_LEVELS,
      } satisfies Answer;
    });
    return { answer: value, ms, rpcCalls };
  },

  score: (agent, ref) => {
    const notes: string[] = [];
    let hits = 0;
    const total = 4;
    if (typeof agent.spacingBusd === "number" && near(agent.spacingBusd, ref.spacingBusd as number, 0.02)) hits += 1;
    else notes.push(`spacing: said ${agent.spacingBusd}, reference ${ref.spacingBusd}`);
    if (typeof agent.perLevelWbnb === "number" && near(agent.perLevelWbnb, ref.perLevelWbnb as number, 0.02)) hits += 1;
    else notes.push(`size per level: said ${agent.perLevelWbnb}, reference ${ref.perLevelWbnb}`);
    if (typeof agent.netPerCrossingBusd === "number" && near(agent.netPerCrossingBusd, ref.netPerCrossingBusd as number, 0.05)) hits += 1;
    else notes.push(`net per crossing: said ${agent.netPerCrossingBusd}, reference ${ref.netPerCrossingBusd}`);
    if (agent.worthRunning === ref.worthRunning) hits += 1;
    else notes.push(`worth running: said ${agent.worthRunning}, reference ${ref.worthRunning}`);
    return { score: hits / total, notes };
  },
};

// ----------------------------------------------------------------- 3. health

export const health: Task = {
  id: "health-factor",
  category: "health",
  title: "How far this loan is from trouble",
  question:
    `On Venus on BNB Smart Chain testnet, look at account ${WATCHED_ACCOUNT}. Report its remaining borrow capacity in ` +
    `dollars and how much it has borrowed in dollars. Its borrow limit is the remaining capacity plus what is already ` +
    `borrowed, and its health factor is that borrow limit divided by what is borrowed. Report both, and report how far ` +
    `the collateral price can fall before the position becomes liquidatable, which is one minus the reciprocal of the ` +
    `health factor, as a percentage.`,

  manualSteps: async () => [
    { where: `BscScan testnet, comptroller ${VENUS_COMPTROLLER}`, action: "open the contract, Read tab" },
    { where: "comptroller, getAccountLiquidity", action: `call it with ${WATCHED_ACCOUNT} and note liquidity and shortfall` },
    { where: `vFDUSD ${VFDUSD}`, action: "open the borrowed market's contract" },
    { where: "vFDUSD, borrowBalanceStored", action: `call it with ${WATCHED_ACCOUNT}` },
    { where: "a calculator", action: "divide by 1e18 to get the borrowed amount" },
    { where: "a calculator", action: "add liquidity and borrowed to get the borrow limit" },
    { where: "a calculator", action: "divide the borrow limit by the borrowed amount for the health factor" },
    { where: "a calculator", action: "subtract the reciprocal of the health factor from one for the fall it can take" },
  ],

  reference: async () => {
    const { value, ms, rpcCalls } = await timed(async () => {
      const liq = await read(comptrollerAbi, VENUS_COMPTROLLER, "getAccountLiquidity", [WATCHED_ACCOUNT]);
      const liquidity = Number(formatUnits(liq[1] as bigint, 18));
      const shortfall = Number(formatUnits(liq[2] as bigint, 18));
      const borrowedRaw = await read(vTokenAbi, VFDUSD, "borrowBalanceStored", [WATCHED_ACCOUNT]);
      const borrowed = Number(formatUnits(borrowedRaw[0] as bigint, 18));

      // FDUSD is a dollar stablecoin, so the borrowed amount is also the
      // borrowed value. Borrow limit is what is still available plus what is
      // already drawn.
      const borrowLimit = liquidity + borrowed;
      const healthFactor = borrowed > 0 ? borrowLimit / borrowed : Infinity;
      const fallToLiquidation = borrowed > 0 ? (1 - 1 / healthFactor) * 100 : 100;

      return {
        borrowLimitUsd: Number(borrowLimit.toFixed(4)),
        borrowedUsd: Number(borrowed.toFixed(4)),
        remainingUsd: Number(liquidity.toFixed(4)),
        shortfallUsd: Number(shortfall.toFixed(4)),
        healthFactor: Number(healthFactor.toFixed(4)),
        collateralFallToLiquidationPct: Number(fallToLiquidation.toFixed(2)),
      } satisfies Answer;
    });
    return { answer: value, ms, rpcCalls };
  },

  score: (agent, ref) => {
    const notes: string[] = [];
    let hits = 0;
    const total = 3;
    if (typeof agent.borrowedUsd === "number" && near(agent.borrowedUsd, ref.borrowedUsd as number, 0.01)) hits += 1;
    else notes.push(`borrowed: said ${agent.borrowedUsd}, reference ${ref.borrowedUsd}`);
    if (typeof agent.healthFactor === "number" && near(agent.healthFactor, ref.healthFactor as number, 0.02)) hits += 1;
    else notes.push(`health factor: said ${agent.healthFactor}, reference ${ref.healthFactor}`);
    if (
      typeof agent.collateralFallToLiquidationPct === "number" &&
      near(agent.collateralFallToLiquidationPct, ref.collateralFallToLiquidationPct as number, 0.05)
    )
      hits += 1;
    else notes.push(`fall to liquidation: said ${agent.collateralFallToLiquidationPct}, reference ${ref.collateralFallToLiquidationPct}`);
    return { score: hits / total, notes };
  },
};

// ------------------------------------------------------------------ 4. yield

export const yieldTask: Task = {
  id: "yield-move",
  category: "yield",
  title: "Where the money should sit instead",
  question:
    `Across every market listed on the Venus comptroller on BNB Smart Chain testnet, find the highest supply APY that a lender ` +
    `could actually use: the market must have cash available, must not have supplying paused, and must be usable as collateral. ` +
    `Report that market, its APY, the APY of vUSDT as a baseline, and what 1000 dollars would earn in a year in each.`,

  manualSteps: async () => {
    const markets = await allMarkets();
    const steps: ManualStep[] = [
      { where: `comptroller ${VENUS_COMPTROLLER}`, action: "call getAllMarkets and copy out every address" },
    ];
    for (const m of markets) {
      steps.push({ where: `vToken ${m}`, action: "open it and read symbol, supplyRatePerBlock, getCash" });
      steps.push({ where: `comptroller, markets(${m})`, action: "read the collateral factor and whether it is listed" });
      steps.push({ where: `comptroller, actionPaused(${m}, 0)`, action: "check whether supplying is paused" });
    }
    steps.push({ where: "a calculator", action: "compound each per-block rate over a year of BNB Chain blocks" });
    steps.push({ where: "a spreadsheet", action: "sort the usable markets and read off the top one" });
    return steps;
  },

  reference: async () => {
    const { value, ms, rpcCalls } = await timed(async () => {
      const addresses = await allMarkets();
      const details = (await Promise.all(addresses.map(marketDetail))).filter(Boolean) as NonNullable<
        Awaited<ReturnType<typeof marketDetail>>
      >[];

      const usable: typeof details = [];
      for (const m of details) {
        if (m.cash <= 0) continue;
        if (m.collateralFactor <= 0) continue;
        const paused = (await read(comptrollerAbi, VENUS_COMPTROLLER, "actionPaused", [m.vToken, 0]))[0] as boolean;
        if (paused) continue;
        usable.push(m);
      }
      usable.sort((a, b) => b.supplyApy - a.supplyApy);

      const best = usable[0];
      const baseline = details.find((m) => m.vToken.toLowerCase() === VUSDT.toLowerCase());
      const baselineApy = baseline ? baseline.supplyApy : 0;

      return {
        bestSymbol: best.symbol,
        bestVToken: best.vToken,
        bestSupplyApy: Number(best.supplyApy.toFixed(2)),
        baselineSymbol: baseline ? baseline.symbol : "vUSDT",
        baselineSupplyApy: Number(baselineApy.toFixed(2)),
        marketsConsidered: details.length,
        marketsUsable: usable.length,
        bestYearOn1000Usd: Number(((best.supplyApy / 100) * 1000).toFixed(2)),
        baselineYearOn1000Usd: Number(((baselineApy / 100) * 1000).toFixed(2)),
      } satisfies Answer;
    });
    return { answer: value, ms, rpcCalls };
  },

  score: (agent, ref) => {
    const notes: string[] = [];
    let hits = 0;
    const total = 3;
    // The market is identified by its address when the agent gives one, because
    // an address is unambiguous. A symbol is accepted with the vToken prefix
    // ignored: "BNB" and "vBNB" name the same market, and marking that wrong
    // would be scoring spelling rather than the answer.
    const strip = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/^v/, "");
    const sameAddress =
      typeof agent.bestVToken === "string" &&
      agent.bestVToken.toLowerCase() === String(ref.bestVToken).toLowerCase();
    if (sameAddress || strip(agent.bestSymbol) === strip(ref.bestSymbol)) hits += 1;
    else notes.push(`best market: said ${agent.bestSymbol ?? agent.bestVToken}, reference ${ref.bestSymbol}`);
    if (typeof agent.bestSupplyApy === "number" && near(agent.bestSupplyApy, ref.bestSupplyApy as number, 0.05)) hits += 1;
    else notes.push(`best APY: said ${agent.bestSupplyApy}, reference ${ref.bestSupplyApy}`);
    if (typeof agent.bestYearOn1000Usd === "number" && near(agent.bestYearOn1000Usd, ref.bestYearOn1000Usd as number, 0.05))
      hits += 1;
    else notes.push(`yearly on 1000: said ${agent.bestYearOn1000Usd}, reference ${ref.bestYearOn1000Usd}`);
    return { score: hits / total, notes };
  },
};

export const TASKS: Task[] = [monitoring, grid, health, yieldTask];
