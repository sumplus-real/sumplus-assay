/**
 * What the agent is allowed to do while it works.
 *
 * The point of a mandate is that it is decided before the run and cannot be
 * argued with during it. Everything here is checked ahead of the call, so a
 * refusal costs nothing, and every refusal carries a sentence.
 */

export type Mandate = {
  /** Ceiling on model spend for one task, in micro-dollars. */
  perTaskCeilingMicroUsd: number;
  /** Hosts the agent may reach. Anything else is refused before the request. */
  allowedHosts: string[];
  /** Tools the agent may call. */
  allowedTools: string[];
  /** Most tool calls the agent may make in one task. */
  maxToolCalls: number;
};

export const DEFAULT_MANDATE: Mandate = {
  perTaskCeilingMicroUsd: 20_000, // two cents
  allowedHosts: ["bsc-testnet-rpc.publicnode.com", "data-seed-prebsc-1-s1.bnbchain.org", "data-seed-prebsc-2-s1.bnbchain.org", "router.sumplus.xyz"],
  allowedTools: ["pool_state", "recent_swaps", "venus_markets", "account_liquidity", "pair_lookup"],
  maxToolCalls: 12,
};

export type Ruling = { decision: "allowed" | "refused"; reason: string };

export function judgeTool(mandate: Mandate, tool: string, callsSoFar: number): Ruling {
  if (!mandate.allowedTools.includes(tool)) {
    return {
      decision: "refused",
      reason: `${tool} is not on this task's tool list, so the agent may not call it.`,
    };
  }
  if (callsSoFar >= mandate.maxToolCalls) {
    return {
      decision: "refused",
      reason: `This task allows ${mandate.maxToolCalls} tool calls and the agent has used them all.`,
    };
  }
  return { decision: "allowed", reason: `${tool} is on the list and the call budget has room.` };
}

export function judgeHost(mandate: Mandate, url: string): Ruling {
  let host: string;
  try {
    host = new URL(url).host.split(":")[0];
  } catch {
    return { decision: "refused", reason: `${url} is not a URL this run can reach.` };
  }
  if (!mandate.allowedHosts.includes(host)) {
    return { decision: "refused", reason: `${host} is outside the allowlist for this run.` };
  }
  return { decision: "allowed", reason: `${host} is on the allowlist.` };
}

export function judgeSpend(mandate: Mandate, spentMicroUsd: number, nextMicroUsd: number): Ruling {
  // A ceiling of zero is a stop, never "no ceiling".
  const after = spentMicroUsd + nextMicroUsd;
  if (after > mandate.perTaskCeilingMicroUsd) {
    return {
      decision: "refused",
      reason: `This call would take the task to ${usd(after)}, past its ceiling of ${usd(mandate.perTaskCeilingMicroUsd)}.`,
    };
  }
  return { decision: "allowed", reason: `Within the ${usd(mandate.perTaskCeilingMicroUsd)} ceiling for this task.` };
}

/** Widen decimals until the printed figure reads back as the same number, so a cost is never shown lower than it is. */
export function usd(microUsd: number): string {
  const dollars = microUsd / 1_000_000;
  for (let places = 2; places <= 6; places += 1) {
    const shown = dollars.toFixed(places);
    if (Number(shown) === dollars) return `$${shown}`;
  }
  return `$${(Math.ceil(dollars * 1e6) / 1e6).toFixed(6)}`;
}
