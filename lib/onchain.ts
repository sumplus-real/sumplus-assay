/**
 * The contracts an assay reads on BNB Smart Chain testnet.
 *
 * Every address here is a public protocol or a token. None of them is a wallet,
 * and this project's wallet transacts only with its own anchor contract, so the
 * on-chain history of this entry stands on its own.
 */

import { Interface, formatUnits } from "ethers";
import { ethCall, getLogs } from "./rpc";

export const PANCAKE_V2_FACTORY = "0x6725F303b657a9451d8BA641348b6761A6CC7a17";
export const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
export const BUSD = "0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7";
/** The deepest testnet pair, and the one every task uses so they agree. */
export const PAIR_BUSD_WBNB = "0x85EcDcdd01EbE0BfD0Aba74B81Ca6d7F4A53582b";

export const VENUS_COMPTROLLER = "0x94d1820b2D1c7c7452A163983Dc888CEC546b77D";

const pairAbi = new Interface([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)",
]);

const comptrollerAbi = new Interface([
  "function getAllMarkets() view returns (address[])",
  "function oracle() view returns (address)",
  // `error` is a reserved word in the human-readable ABI grammar, so these
  // three outputs stay unnamed: they are (error code, liquidity, shortfall).
  "function getAccountLiquidity(address account) view returns (uint256, uint256, uint256)",
  "function markets(address vToken) view returns (bool isListed, uint256 collateralFactorMantissa, bool isVenus)",
  "function getAssetsIn(address account) view returns (address[])",
  "function actionPaused(address,uint8) view returns (bool)",
]);

const vTokenAbi = new Interface([
  "function symbol() view returns (string)",
  "function supplyRatePerBlock() view returns (uint256)",
  "function borrowRatePerBlock() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function getCash() view returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
  "function underlying() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function borrowBalanceStored(address) view returns (uint256)",
]);

async function read(iface: Interface, to: string, fn: string, args: unknown[] = []) {
  const data = iface.encodeFunctionData(fn, args);
  const raw = await ethCall(to, data);
  return iface.decodeFunctionResult(fn, raw);
}

// ---------------------------------------------------------------- pool state

export type PoolState = {
  pair: string;
  reserveBusd: number;
  reserveWbnb: number;
  /** BUSD per WBNB, from reserves alone. */
  price: number;
  lastTradeAt: number;
};

export async function poolState(pair = PAIR_BUSD_WBNB): Promise<PoolState> {
  const [reserves, token0] = await Promise.all([
    read(pairAbi, pair, "getReserves"),
    read(pairAbi, pair, "token0"),
  ]);
  const busdFirst = String(token0[0]).toLowerCase() === BUSD.toLowerCase();
  const r0 = reserves[0] as bigint;
  const r1 = reserves[1] as bigint;
  const busd = Number(formatUnits(busdFirst ? r0 : r1, 18));
  const wbnb = Number(formatUnits(busdFirst ? r1 : r0, 18));
  return {
    pair,
    reserveBusd: busd,
    reserveWbnb: wbnb,
    price: busd / wbnb,
    lastTradeAt: Number(reserves[2]),
  };
}

// -------------------------------------------------------------- swap history

export type Swap = {
  block: number;
  tx: string;
  /** BUSD per WBNB implied by this single trade. */
  price: number;
  /** Positive when the trade bought WBNB. */
  wbnbDelta: number;
};

const SWAP_TOPIC = pairAbi.getEvent("Swap")!.topicHash;

/** Trades on the pair over a window of blocks, newest last. */
export async function recentSwaps(fromBlock: number, toBlock: number, pair = PAIR_BUSD_WBNB): Promise<Swap[]> {
  const token0 = await read(pairAbi, pair, "token0");
  const busdFirst = String(token0[0]).toLowerCase() === BUSD.toLowerCase();

  const logs = await getLogs({
    address: pair,
    topics: [SWAP_TOPIC],
    fromBlock: "0x" + fromBlock.toString(16),
    toBlock: "0x" + toBlock.toString(16),
  });

  const swaps: Swap[] = [];
  for (const log of logs) {
    const parsed = pairAbi.parseLog({ topics: log.topics, data: log.data });
    if (!parsed) continue;
    const a0in = Number(formatUnits(parsed.args.amount0In as bigint, 18));
    const a1in = Number(formatUnits(parsed.args.amount1In as bigint, 18));
    const a0out = Number(formatUnits(parsed.args.amount0Out as bigint, 18));
    const a1out = Number(formatUnits(parsed.args.amount1Out as bigint, 18));
    const busdIn = busdFirst ? a0in : a1in;
    const busdOut = busdFirst ? a0out : a1out;
    const wbnbIn = busdFirst ? a1in : a0in;
    const wbnbOut = busdFirst ? a1out : a0out;

    const busdMoved = busdIn + busdOut;
    const wbnbMoved = wbnbIn + wbnbOut;
    if (wbnbMoved === 0) continue;

    swaps.push({
      block: Number(BigInt(log.blockNumber)),
      tx: log.transactionHash,
      price: busdMoved / wbnbMoved,
      wbnbDelta: wbnbOut - wbnbIn,
    });
  }
  return swaps.sort((a, b) => a.block - b.block);
}

// ------------------------------------------------------------------- lending

export type Market = {
  vToken: string;
  symbol: string;
  supplyApy: number;
  borrowApy: number;
  cash: number;
  borrows: number;
  utilisation: number;
  collateralFactor: number;
};

/** Venus quotes rates per block. BNB Chain produces a block roughly every 0.75s. */
const BLOCKS_PER_YEAR = Math.round((365 * 24 * 60 * 60) / 0.75);

function apyFromPerBlock(perBlock: bigint): number {
  const rate = Number(formatUnits(perBlock, 18));
  // Compounding every block, which is how the protocol actually accrues.
  return (Math.pow(1 + rate, BLOCKS_PER_YEAR) - 1) * 100;
}

export async function allMarkets(): Promise<string[]> {
  const got = await read(comptrollerAbi, VENUS_COMPTROLLER, "getAllMarkets");
  return (got[0] as string[]).map(String);
}

export async function marketDetail(vToken: string): Promise<Market | null> {
  try {
    const [symbol, supply, borrow, cash, borrows, listed] = await Promise.all([
      read(vTokenAbi, vToken, "symbol"),
      read(vTokenAbi, vToken, "supplyRatePerBlock"),
      read(vTokenAbi, vToken, "borrowRatePerBlock"),
      read(vTokenAbi, vToken, "getCash"),
      read(vTokenAbi, vToken, "totalBorrows"),
      read(comptrollerAbi, VENUS_COMPTROLLER, "markets", [vToken]),
    ]);
    const cashN = Number(formatUnits(cash[0] as bigint, 18));
    const borrowsN = Number(formatUnits(borrows[0] as bigint, 18));
    const total = cashN + borrowsN;
    return {
      vToken,
      symbol: String(symbol[0]),
      supplyApy: apyFromPerBlock(supply[0] as bigint),
      borrowApy: apyFromPerBlock(borrow[0] as bigint),
      cash: cashN,
      borrows: borrowsN,
      utilisation: total > 0 ? (borrowsN / total) * 100 : 0,
      collateralFactor: Number(formatUnits(listed[1] as bigint, 18)),
    };
  } catch {
    // A listed market whose vToken does not answer is not a market anyone can
    // use, so it is left out rather than reported as zero.
    return null;
  }
}

export type AccountLiquidity = {
  account: string;
  /** Borrowing capacity still available, in dollars. */
  liquidity: number;
  /** How far past the limit the account already is, in dollars. */
  shortfall: number;
  /** Every market the account has entered, with what it has borrowed there. */
  positions: Array<{ vToken: string; symbol: string; supplied: number; borrowed: number }>;
  /** What the account has borrowed across all markets, in dollars. */
  totalBorrowedUsd: number;
};

export async function accountLiquidity(account: string): Promise<AccountLiquidity> {
  const got = await read(comptrollerAbi, VENUS_COMPTROLLER, "getAccountLiquidity", [account]);
  const liquidity = Number(formatUnits(got[1] as bigint, 18));
  const shortfall = Number(formatUnits(got[2] as bigint, 18));

  // Remaining capacity on its own cannot answer "how much has this account
  // borrowed", and a tool that cannot answer the question it was given makes
  // the agent look wrong for a gap on our side. Every market the account has
  // touched is read here, borrows included.
  const entered = (await read(comptrollerAbi, VENUS_COMPTROLLER, "getAssetsIn", [account]))[0] as string[];
  const candidates = new Set<string>(entered.map(String));
  for (const known of BORROWABLE_TO_CHECK) candidates.add(known);

  const positions: AccountLiquidity["positions"] = [];
  let totalBorrowedUsd = 0;
  for (const vToken of candidates) {
    try {
      const [symbol, supplied, borrowed] = await Promise.all([
        read(vTokenAbi, vToken, "symbol"),
        read(vTokenAbi, vToken, "balanceOf", [account]),
        read(vTokenAbi, vToken, "borrowBalanceStored", [account]),
      ]);
      const borrowedN = Number(formatUnits(borrowed[0] as bigint, 18));
      const suppliedN = Number(formatUnits(supplied[0] as bigint, 8));
      if (borrowedN === 0 && suppliedN === 0) continue;
      positions.push({ vToken, symbol: String(symbol[0]), supplied: suppliedN, borrowed: borrowedN });
      // Every market this account borrows in is a dollar stablecoin, so the
      // amount is also the value. A non-stable borrow would need the oracle.
      totalBorrowedUsd += borrowedN;
    } catch {
      /* a market that does not answer is not part of this account's position */
    }
  }

  return { account, liquidity, shortfall, positions, totalBorrowedUsd };
}

/** Markets worth checking even when the account has not entered them, because borrowing does not require entering. */
const BORROWABLE_TO_CHECK = [
  "0xF06e662a00796c122AaAE935EC4F0Be3F74f5636", // vFDUSD
  "0xb7526572FFE56AB9D7489838Bf2E18e3323b441A", // vUSDT
  "0x08e0A5575De71037aE36AbfAfb516595fE68e5e4", // vBUSD
];

/** Venus action 0 is supplying. A paused market is not one a lender can use. */
export async function supplyPaused(vToken: string): Promise<boolean> {
  try {
    const got = await read(comptrollerAbi, VENUS_COMPTROLLER, "actionPaused", [vToken, 0]);
    return Boolean(got[0]);
  } catch {
    // Unknown is reported as paused, so an unreadable market is never
    // recommended on the strength of a check that did not happen.
    return true;
  }
}
