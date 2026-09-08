/**
 * The Agent Advantage Report.
 *
 * Two numbers in this file are assumptions rather than measurements, and both
 * are printed next to the result so a reader can replace them: how long a
 * person takes over one lookup, and what an hour of that person's time is
 * worth. Everything else is measured.
 *
 * Each assay also carries the rate at which its own conclusion flips. Quoting
 * the crossover is the point: it lets a judge overturn the claim with their own
 * numbers instead of taking ours.
 */

import type { Answer } from "./tasks";
import { stableStringify } from "./receipts";
import { usd } from "./mandate";

/** Stated, not measured. A careful person on a block explorer, per lookup. */
export const SECONDS_PER_LOOKUP = 20;
/** Stated, not measured. */
export const HOURLY_RATE_USD = 60;

export type PathMeasure = {
  label: "manual" | "agent";
  /** Wall clock of the machine doing this path. For the manual path this is a floor, not a human time. */
  ms: number;
  /** Discrete lookups for the manual path; tool calls for the agent. */
  lookups: number;
  rpcCalls: number;
  moneyMicroUsd: number;
  /** Fraction of the reference answer reproduced, 0 to 1. */
  score: number;
  answer: Answer;
  notes: string[];
};

export type AssayResult = {
  taskId: string;
  category: string;
  title: string;
  question: string;
  at: string;
  reference: Answer;
  manual: PathMeasure;
  agent: PathMeasure;
  assumptions: { secondsPerLookup: number; hourlyRateUsd: number };
  derived: {
    humanSeconds: number;
    humanCostMicroUsd: number;
    agentSeconds: number;
    /** Below this many seconds per lookup, doing it by hand is faster than the agent. */
    crossoverSecondsPerLookup: number;
    /** Below this hourly rate, doing it by hand is cheaper than the agent. */
    crossoverHourlyRateUsd: number;
    fasterBy: number;
    verdict: string;
  };
};

export function measureAssay(input: {
  taskId: string;
  category: string;
  title: string;
  question: string;
  reference: Answer;
  manual: PathMeasure;
  agent: PathMeasure;
  secondsPerLookup?: number;
  hourlyRateUsd?: number;
}): AssayResult {
  const secondsPerLookup = input.secondsPerLookup ?? SECONDS_PER_LOOKUP;
  const hourlyRateUsd = input.hourlyRateUsd ?? HOURLY_RATE_USD;

  const humanSeconds = input.manual.lookups * secondsPerLookup;
  const humanCostMicroUsd = Math.ceil((humanSeconds / 3600) * hourlyRateUsd * 1_000_000);
  const agentSeconds = input.agent.ms / 1000;

  const crossoverSecondsPerLookup = input.manual.lookups > 0 ? agentSeconds / input.manual.lookups : Infinity;
  const agentDollars = input.agent.moneyMicroUsd / 1_000_000;
  const crossoverHourlyRateUsd = humanSeconds > 0 ? (agentDollars / humanSeconds) * 3600 : Infinity;

  const fasterBy = agentSeconds > 0 ? humanSeconds / agentSeconds : Infinity;

  let verdict: string;
  if (input.agent.score < 0.999) {
    verdict =
      `The agent was quicker but did not reproduce the reference answer in full, so on this task speed is not the ` +
      `whole story. The disagreements are listed with the run.`;
  } else if (fasterBy >= 2) {
    verdict =
      `The agent reproduced the reference answer and got there ${fasterBy.toFixed(1)} times faster than a person ` +
      `working at ${secondsPerLookup} seconds per lookup. It would take under ${crossoverSecondsPerLookup.toFixed(1)} ` +
      `seconds per lookup by hand to beat it.`;
  } else {
    verdict =
      `The agent reproduced the reference answer, but the task is small enough that a person is competitive: the ` +
      `advantage disappears at ${crossoverSecondsPerLookup.toFixed(1)} seconds per lookup.`;
  }

  return {
    taskId: input.taskId,
    category: input.category,
    title: input.title,
    question: input.question,
    at: new Date().toISOString(),
    reference: input.reference,
    manual: input.manual,
    agent: input.agent,
    assumptions: { secondsPerLookup, hourlyRateUsd },
    derived: {
      humanSeconds,
      humanCostMicroUsd,
      agentSeconds,
      crossoverSecondsPerLookup,
      crossoverHourlyRateUsd,
      fasterBy,
      verdict,
    },
  };
}

/**
 * The exact bytes that get hashed and anchored. Timestamps are included, so an
 * assay hashes to one value and one value only.
 */
export function canonical(result: AssayResult): string {
  return stableStringify(result);
}

export function render(result: AssayResult): string {
  const m = result.manual;
  const a = result.agent;
  const d = result.derived;
  const lines = [
    `${result.category.toUpperCase()} · ${result.taskId}`,
    result.title,
    "",
    `  ${"".padEnd(22)}${"by hand".padStart(16)}${"agent".padStart(16)}`,
    `  ${"steps".padEnd(22)}${String(m.lookups).padStart(16)}${String(a.lookups).padStart(16)}`,
    `  ${"rpc calls".padEnd(22)}${String(m.rpcCalls).padStart(16)}${String(a.rpcCalls).padStart(16)}`,
    `  ${"time".padEnd(22)}${(d.humanSeconds.toFixed(0) + " s").padStart(16)}${(d.agentSeconds.toFixed(1) + " s").padStart(16)}`,
    `  ${"money".padEnd(22)}${usd(d.humanCostMicroUsd).padStart(16)}${usd(a.moneyMicroUsd).padStart(16)}`,
    `  ${"answer matched".padEnd(22)}${"reference".padStart(16)}${((a.score * 100).toFixed(0) + "%").padStart(16)}`,
    "",
    `  ${d.verdict}`,
  ];
  if (a.notes.length) {
    lines.push("", "  Where the agent differed:");
    for (const n of a.notes) lines.push(`    ${n}`);
  }
  lines.push(
    "",
    `  Assumed: ${result.assumptions.secondsPerLookup} seconds per lookup by hand, ` +
      `${usd(result.assumptions.hourlyRateUsd * 1_000_000)} an hour. Both are stated so they can be replaced.`
  );
  return lines.join("\n");
}
