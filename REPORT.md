# Agent Advantage Report

Sumplus Assay · BNB Chain Build the Era, TermiX track
Run generated 2026-09-08T17:36:50.938Z · BNB Smart Chain testnet, chain id 97

Four tasks, each run twice against live chain state: once as a scripted manual
baseline that makes the same lookups a person makes on a block explorer, once by
an agent under a spending mandate. Both paths ran inside the same run and saw the
same block, because a comparison drawn from two different moments is not a
comparison. One task is a trading plan and one is a position risk read.

Live version: https://sumplus-assay-production.up.railway.app/report

## Summary

| Category | Task | Lookups | Time by hand | Cost by hand | Agent time | Agent cost | Quality | Anchor |
|---|---|---|---|---|---|---|---|---|
| monitoring | Is the pool inside its band, and is anyone still trading it | 9 | 180 s | $3.00 | 30.1 s | $0.000404 | 100% | [0xc6df37a2…](https://testnet.bscscan.com/tx/0xc6df37a2ebb14969f7055dbd5d252280e643219467c2af08b8a643dc3d8eb586) |
| grid | What a grid on this pool would actually earn | 8 | 160 s | $2.666667 | 45.2 s | $0.000892 | 100% | [0x9415487e…](https://testnet.bscscan.com/tx/0x9415487e01d36fc0ceee5fba7e6ccd1c29fea855520f6b89f21ec927e70d7cf8) |
| health | How far this loan is from trouble | 8 | 160 s | $2.666667 | 65.9 s | $0.000583 | 100% | [0x38ebc322…](https://testnet.bscscan.com/tx/0x38ebc322bd5980f603b9b85a33e864dcc6382589aab2c32080f90c19b7a5ce50) |
| yield | Where the money should sit instead | 150 | 3000 s | $50.00 | 105 s | $0.002332 | 100% | [0x302cf7c7…](https://testnet.bscscan.com/tx/0x302cf7c7e6772003c6ece8ff1bae78acb4d4cd95abafaaad3c2a0e192c1e89c8) |
| **Total** | | | **3500 s** | **$58.333334** | **247 s** | **$0.004211** | **4/4** | |

The agent was 14.2 times faster overall and cost
13853 times less at the stated rate.

## What is measured and what is assumed

Measured: agent wall clock, tool calls, RPC calls, tokens in and out priced at the
gateway's published rate for the line the request was pinned to, and whether the
answer matched the reference field by field.

Assumed: 20 seconds for a person to make one lookup on a
block explorer, and $60.00 an hour for that
person's time. Both are stated rather than buried, and each task below carries the
rate at which its own conclusion flips, so a reader can overturn the claim with
their own numbers instead of taking ours.

If a model response ever arrives without a usage block, the run records that fact
and prices the call from a deliberately high estimate. A missing field is never
read as zero cost.

## monitoring · Is the pool inside its band, and is anyone still trading it

**Question.** On BNB Smart Chain testnet, look at the PancakeSwap v2 BUSD/WBNB pool. Report the current price in BUSD per WBNB, whether that price is within 2% of 440, and how many trades the pool has seen in the last 4000 blocks.

| | by hand | agent |
|---|---|---|
| steps | 9 lookups | 3 tool calls |
| RPC reads | 5 | 7 |
| time | 180 s | 30.1 s |
| cost | $3.00 | $0.000404 |
| tokens | | 2470 in / 201 out |
| answer | reference | 100% reproduced |

The agent reproduced the reference answer and got there 6.0 times faster than a person working at 20 seconds per lookup. It would take under 3.3 seconds per lookup by hand to beat it.

**The answer, field by field.**

| Field | Reference | Agent |
|---|---|---|
| `price` | 438.6981 | 438.6981 |
| `reserveBusd` | 5535.5597 | 5535.5597 |
| `reserveWbnb` | 12.618154 | 12.6182 |
| `withinBand` | true | true |
| `tradesLast4000Blocks` | 0 | 0 |

**What the manual path does.** 9 lookups, in order.

1. BscScan testnet, factory 0x6725F303b657a9451d8BA641348b6761A6CC7a17 — open the contract, Read tab
1. factory, getPair — call getPair(0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd, 0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7)
1. pair 0x85EcDcdd01EbE0BfD0Aba74B81Ca6d7F4A53582b — open the pair contract
1. pair, token0 — call token0 to learn which reserve is which
1. pair, getReserves — call getReserves and note both numbers
1. a calculator — divide both reserves by 1e18
1. a calculator — divide BUSD reserve by WBNB reserve to get the price
1. a calculator — check the price against 440 plus or minus 2%
1. BscScan, pair Events tab — filter Swap events over the last 4000 blocks and count them

**What the agent did.** 7 receipts, chained and rebuilt from
scratch by the verifier: intact.

| # | Step | Detail | Ruling | Cost |
|---|---|---|---|---|
| 0 | model.call | deepseek-v4-flash round 1 | allowed | $0.000116 |
| 1 | tool.call | pool_state | allowed | $0.00 |
| 2 | tool.call | recent_swaps | allowed | $0.00 |
| 3 | model.call | deepseek-v4-flash round 2 | allowed | $0.000127 |
| 4 | tool.call | pool_state | allowed | $0.00 |
| 5 | model.call | deepseek-v4-flash round 3 | allowed | $0.000161 |
| 6 | answer | 5 fields | allowed | $0.00 |

**Anchor.** Assay hash `0x41e360423a700d1e147bae1aaa4d3d24f2244423767ef9571eda2f1b43605ffe` in block 129871467,
[transaction](https://testnet.bscscan.com/tx/0xc6df37a2ebb14969f7055dbd5d252280e643219467c2af08b8a643dc3d8eb586).

## grid · What a grid on this pool would actually earn

**Question.** Using the current price of the PancakeSwap v2 BUSD/WBNB pool on BNB Smart Chain testnet, plan a 8-level grid spanning 10% either side of the price, for an inventory of 2 WBNB. Levels are evenly spaced, so the spacing is the full range divided by 7. The inventory is split evenly, so each level holds 2/8 WBNB. One crossing buys at a level and sells at the next, so it earns the level size times the spacing, minus the pool's 0.25% fee charged on the level's value at the current price, once on the way in and once on the way out. Report the spacing in BUSD, the WBNB at each level, the net BUSD from one crossing, and whether this pool trades often enough for the grid to be worth running.

| | by hand | agent |
|---|---|---|
| steps | 8 lookups | 4 tool calls |
| RPC reads | 5 | 10 |
| time | 160 s | 45.2 s |
| cost | $2.666667 | $0.000892 |
| tokens | | 4664 in / 843 out |
| answer | reference | 100% reproduced |

The agent reproduced the reference answer and got there 3.5 times faster than a person working at 20 seconds per lookup. It would take under 5.7 seconds per lookup by hand to beat it.

**The answer, field by field.**

| Field | Reference | Agent |
|---|---|---|
| `price` | 438.6981 | 438.6980758124596 |
| `lowerBound` | 394.8283 | 394.8282682312136 |
| `upperBound` | 482.5679 | 482.5678833937056 |
| `spacingBusd` | 12.5342 | 12.5342307374989 |
| `perLevelWbnb` | 0.25 | 0.25 |
| `netPerCrossingBusd` | 2.5852 | 2.58518508960916 |
| `tradesLast4000Blocks` | 0 | 0 |
| `worthRunning` | false | false |

**What the manual path does.** 8 lookups, in order.

1. pair 0x85EcDcdd01EbE0BfD0Aba74B81Ca6d7F4A53582b — call getReserves and token0, as in the first task
1. a calculator — derive the current price
1. a calculator — take 0.90x and 1.10x the price for the range
1. a calculator — divide the range into 8 levels and write each one out
1. a calculator — divide 2 WBNB across the levels
1. a calculator — multiply one level's size by the spacing, then subtract the 0.25% fee twice, once each way
1. BscScan, pair Events tab — count Swap events over the last 4000 blocks
1. your own judgement — decide whether that trade count can cross the grid often enough to pay

**What the agent did.** 9 receipts, chained and rebuilt from
scratch by the verifier: intact.

| # | Step | Detail | Ruling | Cost |
|---|---|---|---|---|
| 0 | model.call | deepseek-v4-flash round 1 | allowed | $0.000134 |
| 1 | tool.call | pool_state | allowed | $0.00 |
| 2 | tool.call | recent_swaps | allowed | $0.00 |
| 3 | model.call | deepseek-v4-flash round 2 | allowed | $0.000239 |
| 4 | tool.call | pool_state | allowed | $0.00 |
| 5 | model.call | deepseek-v4-flash round 3 | allowed | $0.000209 |
| 6 | tool.call | recent_swaps | allowed | $0.00 |
| 7 | model.call | deepseek-v4-flash round 4 | allowed | $0.00031 |
| 8 | answer | 8 fields | allowed | $0.00 |

**Anchor.** Assay hash `0x77ea5a5c5c55811b205d39c7ce8271906e60997ca65cfaa051541505c1db8253` in block 129871669,
[transaction](https://testnet.bscscan.com/tx/0x9415487e01d36fc0ceee5fba7e6ccd1c29fea855520f6b89f21ec927e70d7cf8).

## health · How far this loan is from trouble

**Question.** On Venus on BNB Smart Chain testnet, look at account 0x5B5183A1Dd146A178C641ABdAced49199A54daCE. Report its remaining borrow capacity in dollars and how much it has borrowed in dollars. Its borrow limit is the remaining capacity plus what is already borrowed, and its health factor is that borrow limit divided by what is borrowed. Report both, and report how far the collateral price can fall before the position becomes liquidatable, which is one minus the reciprocal of the health factor, as a percentage.

| | by hand | agent |
|---|---|---|
| steps | 8 lookups | 2 tool calls |
| RPC reads | 2 | 28 |
| time | 160 s | 65.9 s |
| cost | $2.666667 | $0.000583 |
| tokens | | 3033 in / 560 out |
| answer | reference | 100% reproduced |

The agent reproduced the reference answer and got there 2.4 times faster than a person working at 20 seconds per lookup. It would take under 8.2 seconds per lookup by hand to beat it.

**The answer, field by field.**

| Field | Reference | Agent |
|---|---|---|
| `borrowLimitUsd` | 4.8016 | 4.801633307599061 |
| `borrowedUsd` | 2.4 | 2.4 |
| `remainingUsd` | 2.4016 | 2.4016333075990612 |
| `shortfallUsd` | 0 | 0 |
| `healthFactor` | 2.0007 | 2.000680544832942 |
| `collateralFallToLiquidationPct` | 50.02 | 50.017 |

**What the manual path does.** 8 lookups, in order.

1. BscScan testnet, comptroller 0x94d1820b2D1c7c7452A163983Dc888CEC546b77D — open the contract, Read tab
1. comptroller, getAccountLiquidity — call it with 0x5B5183A1Dd146A178C641ABdAced49199A54daCE and note liquidity and shortfall
1. vFDUSD 0xF06e662a00796c122AaAE935EC4F0Be3F74f5636 — open the borrowed market's contract
1. vFDUSD, borrowBalanceStored — call it with 0x5B5183A1Dd146A178C641ABdAced49199A54daCE
1. a calculator — divide by 1e18 to get the borrowed amount
1. a calculator — add liquidity and borrowed to get the borrow limit
1. a calculator — divide the borrow limit by the borrowed amount for the health factor
1. a calculator — subtract the reciprocal of the health factor from one for the fall it can take

**What the agent did.** 6 receipts, chained and rebuilt from
scratch by the verifier: intact.

| # | Step | Detail | Ruling | Cost |
|---|---|---|---|---|
| 0 | model.call | deepseek-v4-flash round 1 | allowed | $0.000127 |
| 1 | tool.call | account_liquidity | allowed | $0.00 |
| 2 | model.call | deepseek-v4-flash round 2 | allowed | $0.000162 |
| 3 | tool.call | account_liquidity | allowed | $0.00 |
| 4 | model.call | deepseek-v4-flash round 3 | allowed | $0.000294 |
| 5 | answer | 6 fields | allowed | $0.00 |

**Anchor.** Assay hash `0x963569eab00b8bcd7d549557004b84922160625c8e377348aab89bca4cdffe23` in block 129871858,
[transaction](https://testnet.bscscan.com/tx/0x38ebc322bd5980f603b9b85a33e864dcc6382589aab2c32080f90c19b7a5ce50).

## yield · Where the money should sit instead

**Question.** Across every market listed on the Venus comptroller on BNB Smart Chain testnet, find the highest supply APY that a lender could actually use: the market must have cash available, must not have supplying paused, and must be usable as collateral. Report that market, its APY, the APY of vUSDT as a baseline, and what 1000 dollars would earn in a year in each.

| | by hand | agent |
|---|---|---|
| steps | 150 lookups | 2 tool calls |
| RPC reads | 322 | 346 |
| time | 3000 s | 105 s |
| cost | $50.00 | $0.002332 |
| tokens | | 12051 in / 2298 out |
| answer | reference | 100% reproduced |

The agent reproduced the reference answer and got there 28.5 times faster than a person working at 20 seconds per lookup. It would take under 0.7 seconds per lookup by hand to beat it.

**The answer, field by field.**

| Field | Reference | Agent |
|---|---|---|
| `bestSymbol` | vBNB | vBNB |
| `bestVToken` | 0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c | 0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c |
| `bestSupplyApy` | 23.52 | 23.52 |
| `baselineSymbol` | vUSDT | vUSDT |
| `baselineSupplyApy` | 0 | 0 |
| `marketsConsidered` | 49 | 49 |
| `marketsUsable` | 25 | 25 |
| `bestYearOn1000Usd` | 235.23 | 235.2 |
| `baselineYearOn1000Usd` | 0 | 0 |

**What the manual path does.** 150 lookups, in order.

1. comptroller 0x94d1820b2D1c7c7452A163983Dc888CEC546b77D — call getAllMarkets and copy out every address
1. vToken 0xD5C4C2e2facBEB59D0216D0595d63FcDc6F9A1a7 — open it and read symbol, supplyRatePerBlock, getCash
1. comptroller, markets(0xD5C4C2e2facBEB59D0216D0595d63FcDc6F9A1a7) — read the collateral factor and whether it is listed
1. comptroller, actionPaused(0xD5C4C2e2facBEB59D0216D0595d63FcDc6F9A1a7, 0) — check whether supplying is paused
1. vToken 0xb7526572FFE56AB9D7489838Bf2E18e3323b441A — open it and read symbol, supplyRatePerBlock, getCash
1. comptroller, markets(0xb7526572FFE56AB9D7489838Bf2E18e3323b441A) — read the collateral factor and whether it is listed
1. comptroller, actionPaused(0xb7526572FFE56AB9D7489838Bf2E18e3323b441A, 0) — check whether supplying is paused
1. vToken 0x08e0A5575De71037aE36AbfAfb516595fE68e5e4 — open it and read symbol, supplyRatePerBlock, getCash
1. comptroller, markets(0x08e0A5575De71037aE36AbfAfb516595fE68e5e4) — read the collateral factor and whether it is listed
1. comptroller, actionPaused(0x08e0A5575De71037aE36AbfAfb516595fE68e5e4, 0) — check whether supplying is paused
1. …and 140 more of the same shape, one market at a time.

**What the agent did.** 6 receipts, chained and rebuilt from
scratch by the verifier: intact.

| # | Step | Detail | Ruling | Cost |
|---|---|---|---|---|
| 0 | model.call | deepseek-v4-flash round 1 | allowed | $0.000114 |
| 1 | tool.call | venus_markets | allowed | $0.00 |
| 2 | model.call | deepseek-v4-flash round 2 | allowed | $0.001204 |
| 3 | tool.call | pool_state | allowed | $0.00 |
| 4 | model.call | deepseek-v4-flash round 3 | allowed | $0.001014 |
| 5 | answer | 9 fields | allowed | $0.00 |

**Anchor.** Assay hash `0x28ad67397834e8840323a95e6d01c3cc1270fb8d3e137f742d6e4d6d3223173e` in block 129872232,
[transaction](https://testnet.bscscan.com/tx/0x302cf7c7e6772003c6ece8ff1bae78acb4d4cd95abafaaad3c2a0e192c1e89c8).

## Why this report can be checked

Each assay is canonicalised with sorted keys, hashed with keccak, and anchored in
its own transaction on [`0xdc3cec958Ac2bBaDA749EC4Cf49ac01507F5297B`](https://testnet.bscscan.com/address/0xdc3cec958Ac2bBaDA749EC4Cf49ac01507F5297B)
before this submission. The anchors are chained to each other, and the contract
rebuilds that chain on request through `recomputeHead()`, so a stored head that
nobody recomputes is not what anyone is being asked to trust.

Running `npm run verify` recomputes every hash from the numbers above, rebuilds
every receipt chain, reads each anchor back off chain by index, and compares the
stored head against the rebuilt one. Point it at an edited copy of the report and
the edited assay fails twice while the others keep passing.

## What is not claimed

- The chain stores a hash, not the report. Without the published report the hash
  proves nothing on its own.
- An anchor proves the numbers existed at that block. It does not prove the run
  behind them was well designed; that is what the manual baseline and the
  published crossover are for.
- The human seconds and the hourly rate are stated assumptions, not measurements.
