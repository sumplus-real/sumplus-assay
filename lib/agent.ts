/**
 * The agent path.
 *
 * The agent is given the question in words and a small set of tools that read
 * BNB Smart Chain testnet. It decides what to look at. It does not decide
 * whether it is allowed to: the mandate is checked before every call, refusals
 * are recorded with a sentence, and the run stops at its spending ceiling.
 *
 * Model access goes through the Sumplus gateway, so what a run cost is metered
 * by the same thing that served it rather than estimated afterwards.
 */

import { blockNumber, traffic } from "./rpc";
import { poolState, recentSwaps, allMarkets, marketDetail, supplyPaused } from "./onchain";
import { accountLiquidity } from "./onchain";
import { DEFAULT_MANDATE, judgeSpend, judgeTool, type Mandate } from "./mandate";
import { Ledger } from "./receipts";
import type { Answer } from "./tasks";

export type ModelConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * Which upstream line to use, by its internal provider name. The same model
   * id is offered on several, and a run priced against one line while served by
   * another is a run whose cost figure is fiction, so this is named rather than
   * left to a default.
   */
  provider?: string;
  /** Dollars per million tokens, so a run can be priced from its own usage. */
  inputPerMillion: number;
  outputPerMillion: number;
};

export function modelFromEnv(): ModelConfig {
  const baseUrl = process.env.SUMPLUS_ROUTER_URL ?? "https://router.sumplus.xyz/v1";
  const apiKey = process.env.SUMPLUS_ROUTER_KEY ?? "";
  if (!apiKey) throw new Error("SUMPLUS_ROUTER_KEY is not set, so the agent path cannot run.");
  return {
    baseUrl,
    apiKey,
    model: process.env.SUMPLUS_MODEL ?? "deepseek-v4-flash",
    provider: process.env.SUMPLUS_PROVIDER ?? "cm",
    inputPerMillion: Number(process.env.SUMPLUS_INPUT_PER_M ?? 0.14),
    outputPerMillion: Number(process.env.SUMPLUS_OUTPUT_PER_M ?? 0.28),
  };
}

// ------------------------------------------------------------------- the tools

type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

const TOOLS = [
  {
    type: "function",
    function: {
      name: "pool_state",
      description:
        "Current state of the PancakeSwap v2 BUSD/WBNB pool on BNB Smart Chain testnet: both reserves and the price in BUSD per WBNB.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "recent_swaps",
      description: "How many trades the pool has seen over the last N blocks, and the prices they traded at.",
      parameters: {
        type: "object",
        properties: { blocks: { type: "integer", description: "How many blocks back to look, at most 4000." } },
        required: ["blocks"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "venus_markets",
      description:
        "Every market listed on the Venus comptroller on BNB Smart Chain testnet, each with its symbol, supply and borrow APY, available cash, utilisation, collateral factor, and whether supplying is paused.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "account_liquidity",
      description:
        "A Venus account's remaining borrow capacity and shortfall in dollars, every market it holds a position in, what it has supplied and borrowed in each, and its total borrowed in dollars.",
      parameters: {
        type: "object",
        properties: { account: { type: "string", description: "The address to look up." } },
        required: ["account"],
      },
    },
  },
] as const;

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case "pool_state": {
        const pool = await poolState();
        return { ok: true, data: { price: pool.price, reserveBusd: pool.reserveBusd, reserveWbnb: pool.reserveWbnb } };
      }
      case "recent_swaps": {
        const blocks = Math.min(Number(args.blocks ?? 4000), 4000);
        const head = await blockNumber();
        const swaps = await recentSwaps(head - blocks, head);
        return { ok: true, data: { blocks, count: swaps.length, prices: swaps.map((s) => Number(s.price.toFixed(4))) } };
      }
      case "venus_markets": {
        const addresses = await allMarkets();
        const rows = (await Promise.all(addresses.map(marketDetail))).filter(Boolean);
        // Whether supplying is paused has to be in here. The task asks for the
        // best market a lender can actually use, and without this field the
        // agent is being marked against a rule it has no way to apply.
        const paused = await Promise.all(rows.map((m) => supplyPaused(m!.vToken)));
        return {
          ok: true,
          data: rows.map((m, i) => ({
            symbol: m!.symbol,
            vToken: m!.vToken,
            supplyApy: Number(m!.supplyApy.toFixed(2)),
            borrowApy: Number(m!.borrowApy.toFixed(2)),
            cash: Number(m!.cash.toFixed(4)),
            utilisation: Number(m!.utilisation.toFixed(1)),
            collateralFactor: m!.collateralFactor,
            supplyPaused: paused[i],
          })),
        };
      }
      case "account_liquidity": {
        const got = await accountLiquidity(String(args.account));
        return { ok: true, data: got };
      }
      default:
        return { ok: false, error: `${name} is not a tool this run has.` };
    }
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 200) };
  }
}

// --------------------------------------------------------------- the request

/**
 * The body sent to the gateway.
 *
 * The same model id is offered on three upstream lines at different context
 * limits, and an unpinned request goes to whichever the gateway prefers. Naming
 * the line is therefore part of the measurement: a run priced against one rate
 * card while served by another reports a cost it did not incur.
 *
 * The line is named by its internal provider name in lower case, inside the
 * `saferouter` object the gateway strips before forwarding. The display code in
 * the catalogue, the `[C]` in a model's name, is not a request parameter, and
 * the model field takes the bare catalogue id.
 */
export function requestBody(config: ModelConfig, messages: Array<Record<string, unknown>>) {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    tools: TOOLS,
    temperature: 0,
  };
  if (config.provider) body.saferouter = { provider: config.provider };
  return body;
}

/**
 * One round trip to the gateway, retried.
 *
 * The local network drops TLS mid-request often enough that a single failure
 * says nothing, so a transport error is retried. A refusal from the gateway
 * itself is not: a 4xx is an answer, and retrying it would only spend money
 * repeating a mistake.
 */
async function postWithRetry(config: ModelConfig, body: unknown, tries = 4): Promise<unknown> {
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status >= 400 && res.status < 500) {
        throw new GatewayRefusal(`gateway answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      if (!res.ok) throw new Error(`gateway answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return await res.json();
    } catch (err) {
      if (err instanceof GatewayRefusal) throw err;
      last = err;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  throw new Error(`gateway unreachable after ${tries} attempts: ${String(last)}`);
}

export class GatewayRefusal extends Error {}

// ------------------------------------------------------------------- the run

export type AgentRun = {
  answer: Answer;
  ms: number;
  toolCalls: number;
  rpcCalls: number;
  moneyMicroUsd: number;
  promptTokens: number;
  completionTokens: number;
  /** False when the gateway did not report usage and the cost above is an upper-bound estimate. */
  usageReported: boolean;
  ledger: Ledger;
  transcriptNote: string;
};

const SYSTEM = [
  "You read BNB Smart Chain testnet through the tools you are given and answer with numbers.",
  "Call tools until you have what you need, then reply with a single JSON object and nothing else.",
  "Use exactly the field names the question asks for. Numbers must be numbers, not strings.",
  "Do not guess a value you could look up, and do not round beyond four decimal places.",
].join(" ");

export async function runAgent(
  question: string,
  fields: string[],
  config: ModelConfig,
  mandate: Mandate = DEFAULT_MANDATE
): Promise<AgentRun> {
  const ledger = new Ledger();
  const rpcBefore = traffic.calls;
  const t0 = Date.now();

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `${question}\n\nReply with a JSON object containing exactly these fields: ${fields.join(", ")}.`,
    },
  ];

  let promptTokens = 0;
  let completionTokens = 0;
  let toolCalls = 0;
  let spentMicroUsd = 0;
  let answerText = "";
  /** False as soon as one round comes back without a usage block. */
  let usageReported = true;
  /** The model gets one prompt to produce its answer before the run gives up. */
  let nudged = false;

  for (let round = 0; round < 8; round += 1) {
    const body = (await postWithRetry(config, requestBody(config, messages))) as {
      choices: Array<{ message: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    // A missing usage block must never be read as zero tokens. Reporting a run
    // as free because the gateway did not say what it cost is the one failure
    // this whole project exists to avoid, so an absent usage block falls back to
    // a deliberately generous estimate and marks the run as not metered.
    const reported = body.usage;
    const hasUsage = typeof reported?.prompt_tokens === "number" && typeof reported?.completion_tokens === "number";
    let usedIn: number;
    let usedOut: number;
    if (hasUsage) {
      usedIn = reported!.prompt_tokens!;
      usedOut = reported!.completion_tokens!;
    } else {
      usageReported = false;
      usedIn = estimateTokens(JSON.stringify(messages) + JSON.stringify(TOOLS));
      usedOut = estimateTokens(JSON.stringify(body.choices?.[0]?.message ?? ""));
    }
    promptTokens += usedIn;
    completionTokens += usedOut;

    // Round up, so a run is never reported as cheaper than it was.
    const roundMicroUsd = Math.ceil(
      (usedIn / 1_000_000) * config.inputPerMillion * 1_000_000 + (usedOut / 1_000_000) * config.outputPerMillion * 1_000_000
    );
    const spendRuling = judgeSpend(mandate, spentMicroUsd, roundMicroUsd);
    spentMicroUsd += roundMicroUsd;
    ledger.append({
      step: "model.call",
      detail: `${config.model} round ${round + 1}`,
      decision: spendRuling.decision,
      reason: spendRuling.reason,
      payload: { promptTokens: usedIn, completionTokens: usedOut },
      costMicroUsd: roundMicroUsd,
    });
    if (spendRuling.decision === "refused") break;

    const choice = body.choices?.[0]?.message;
    if (!choice) throw new Error("gateway returned no message");

    if (choice.tool_calls?.length) {
      messages.push({ role: "assistant", content: choice.content ?? null, tool_calls: choice.tool_calls });
      for (const call of choice.tool_calls) {
        const ruling = judgeTool(mandate, call.function.name, toolCalls);
        if (ruling.decision === "refused") {
          ledger.append({
            step: "tool.call",
            detail: call.function.name,
            decision: "refused",
            reason: ruling.reason,
            payload: { arguments: call.function.arguments },
          });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: ruling.reason }) });
          continue;
        }
        toolCalls += 1;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          /* a malformed argument list is the agent's problem to notice */
        }
        const result = await callTool(call.function.name, args);
        ledger.append({
          step: "tool.call",
          detail: call.function.name,
          decision: "allowed",
          reason: ruling.reason,
          payload: { arguments: args, ok: result.ok },
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 60_000) });
      }
      continue;
    }

    // This line answers a tool-calling turn with "\n\n" rather than an empty
    // string, so "content is truthy" is not the same as "the model said
    // something". Treating whitespace as an answer would score the run at zero
    // and blame the model for a bug in the harness.
    const said = (choice.content ?? "").trim();
    if (!said) {
      if (nudged) break;
      nudged = true;
      messages.push({ role: "assistant", content: choice.content ?? "" });
      messages.push({
        role: "user",
        content: `Reply now with only the JSON object, containing exactly these fields: ${fields.join(", ")}.`,
      });
      continue;
    }

    answerText = said;
    break;
  }

  const ms = Date.now() - t0;
  const answer = parseAnswer(answerText);
  ledger.append({
    step: "answer",
    detail: `${Object.keys(answer).length} fields`,
    decision: "allowed",
    reason: "The agent finished and produced an answer.",
    payload: answer,
  });

  return {
    answer,
    ms,
    toolCalls,
    rpcCalls: traffic.calls - rpcBefore,
    moneyMicroUsd: spentMicroUsd,
    promptTokens,
    completionTokens,
    usageReported,
    ledger,
    transcriptNote: answerText.slice(0, 400),
  };
}

/**
 * A deliberately high token estimate, used only when the gateway does not
 * report usage. Three characters per token is below every tokeniser in common
 * use, which makes the resulting count too large rather than too small.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** Models like to wrap JSON in prose or a fence. Take the first object that parses. */
export function parseAnswer(text: string): Answer {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text.match(/\{[\s\S]*\}/)?.[0], text].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c.trim());
      if (parsed && typeof parsed === "object") return parsed as Answer;
    } catch {
      /* try the next shape */
    }
  }
  return {};
}
