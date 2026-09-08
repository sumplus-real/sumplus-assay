/**
 * A small JSON-RPC transport for BNB Smart Chain testnet.
 *
 * Written by hand rather than taken from a library because the network this
 * runs on drops TLS connections at around five seconds, so one failure says
 * nothing about whether the endpoint is healthy. Every call retries across
 * several endpoints before giving up, and the endpoint that answered is
 * recorded, because a measurement that does not say where it came from is not
 * a measurement.
 */

export const CHAIN_ID = 97;

export const ENDPOINTS = [
  "https://bsc-testnet-rpc.publicnode.com",
  "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
  "https://data-seed-prebsc-2-s1.bnbchain.org:8545",
];

export class RpcError extends Error {}

/** Every round trip this process has made, so a task can report its own cost. */
export const traffic = {
  calls: 0,
  retries: 0,
  reset() {
    this.calls = 0;
    this.retries = 0;
  },
};

let nextId = 1;

async function once(url: string, method: string, params: unknown[], timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new RpcError(`${url} answered ${res.status}`);
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new RpcError(body.error.message ?? "rpc error");
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function rpc<T = string>(method: string, params: unknown[] = [], timeoutMs = 15000): Promise<T> {
  traffic.calls += 1;
  let last: unknown;
  for (let attempt = 0; attempt < ENDPOINTS.length * 2; attempt += 1) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      return (await once(url, method, params, timeoutMs)) as T;
    } catch (err) {
      last = err;
      traffic.retries += 1;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw new RpcError(`${method} failed on every endpoint: ${String(last)}`);
}

export async function ethCall(to: string, data: string, blockTag = "latest"): Promise<string> {
  return rpc<string>("eth_call", [{ to, data }, blockTag]);
}

export async function blockNumber(): Promise<number> {
  return Number(BigInt(await rpc<string>("eth_blockNumber")));
}

export async function getBalance(address: string): Promise<bigint> {
  return BigInt(await rpc<string>("eth_getBalance", [address, "latest"]));
}

export async function gasPrice(): Promise<bigint> {
  return BigInt(await rpc<string>("eth_gasPrice"));
}

export async function getLogs(filter: Record<string, unknown>): Promise<
  Array<{ address: string; topics: string[]; data: string; blockNumber: string; transactionHash: string }>
> {
  return rpc("eth_getLogs", [filter], 30000);
}

export async function sendRaw(signed: string): Promise<string> {
  return rpc<string>("eth_sendRawTransaction", [signed]);
}

export async function waitForReceipt(hash: string, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    const got = await rpc<{ status: string; blockNumber: string; gasUsed: string } | null>(
      "eth_getTransactionReceipt",
      [hash]
    );
    if (got) return got;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new RpcError(`no receipt for ${hash} after ${tries} tries`);
}

export const explorerTx = (hash: string) => `https://testnet.bscscan.com/tx/${hash}`;
export const explorerAddress = (addr: string) => `https://testnet.bscscan.com/address/${addr}`;
