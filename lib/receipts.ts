/**
 * The record an assay leaves behind.
 *
 * One receipt per step, chained. The verifier recomputes every receipt from its
 * own contents and carries the recomputed hash forward, trusting none of the
 * stored ones. Carrying a stored hash would stop an edit from reaching the next
 * receipt, and a chain where tampering does not propagate is just a list.
 */

import { createHash } from "node:crypto";

export const GENESIS = "0".repeat(64);

export type Decision = "allowed" | "refused";

export type Receipt = {
  seq: number;
  at: string;
  step: string;
  detail: string;
  decision: Decision;
  /** A sentence, always. "Refused" with no reason is what makes people switch a control off. */
  reason: string;
  costMicroUsd: number;
  payloadHash: string;
  prevHash: string;
  hash: string;
};

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export const hashPayload = (payload: unknown) => sha256(stableStringify(payload));

/** Key order must not change the hash, or two identical payloads disagree. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** The bytes a receipt commits to. Field order is part of the format. */
export function preimage(r: Receipt): string {
  return [r.seq, r.at, r.step, r.detail, r.decision, r.reason, r.costMicroUsd, r.payloadHash, r.prevHash].join("\n");
}

export class Ledger {
  readonly receipts: Receipt[] = [];

  get head(): string {
    return this.receipts.length ? this.receipts[this.receipts.length - 1].hash : GENESIS;
  }

  get costMicroUsd(): number {
    return this.receipts.reduce((sum, r) => sum + r.costMicroUsd, 0);
  }

  append(input: {
    step: string;
    detail: string;
    decision: Decision;
    reason: string;
    payload: unknown;
    costMicroUsd?: number;
  }): Receipt {
    const r: Receipt = {
      seq: this.receipts.length,
      at: new Date().toISOString(),
      step: input.step,
      detail: input.detail,
      decision: input.decision,
      reason: input.reason,
      costMicroUsd: input.costMicroUsd ?? 0,
      payloadHash: hashPayload(input.payload),
      prevHash: this.head,
      hash: "",
    };
    r.hash = sha256(preimage(r));
    this.receipts.push(r);
    return r;
  }
}

export type Problem = { seq: number; kind: "bad-sequence" | "broken-link" | "hash-mismatch"; detail: string };

export type Verification = { ok: boolean; length: number; head: string; problems: Problem[] };

export const short = (h: string, n = 10) => (h.length <= n * 2 ? h : `${h.slice(0, n)}…${h.slice(-4)}`);

export function verify(receipts: readonly Receipt[]): Verification {
  const problems: Problem[] = [];
  let expectedPrev = GENESIS;
  let last = GENESIS;

  receipts.forEach((r, index) => {
    if (r.seq !== index) {
      problems.push({ seq: r.seq, kind: "bad-sequence", detail: `numbered ${r.seq} but sits at position ${index}` });
    }
    if (r.prevHash !== expectedPrev) {
      problems.push({
        seq: r.seq,
        kind: "broken-link",
        detail: `points at ${short(r.prevHash)} but the receipt before it hashes to ${short(expectedPrev)}`,
      });
    }
    const recomputed = sha256(preimage(r));
    if (recomputed !== r.hash) {
      problems.push({
        seq: r.seq,
        kind: "hash-mismatch",
        detail: `contents hash to ${short(recomputed)}, receipt claims ${short(r.hash)}`,
      });
    }
    // Carry the recomputed hash, never the stored one.
    expectedPrev = recomputed;
    last = r.hash;
  });

  return { ok: problems.length === 0, length: receipts.length, head: last, problems };
}
