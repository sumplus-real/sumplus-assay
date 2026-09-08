/**
 * Putting a finished assay on chain.
 *
 * The chain is not storing the report. It is storing one hash of it, so that a
 * report shown later can be checked against a block that predates the moment
 * anyone had a reason to improve the numbers.
 */

import { Interface, Wallet, keccak256, toUtf8Bytes } from "ethers";
import { CHAIN_ID, ENDPOINTS, rpc, sendRaw, waitForReceipt, ethCall, explorerTx } from "./rpc";

export const ASSAY_ANCHOR = "0xdc3cec958Ac2bBaDA749EC4Cf49ac01507F5297B";

const anchorAbi = new Interface([
  "function anchor(bytes32 assayHash, string category) returns (uint256)",
  "function head() view returns (bytes32)",
  "function count() view returns (uint256)",
  "function recomputeHead() view returns (bytes32)",
  "function get(uint256) view returns (tuple(bytes32 assayHash, bytes32 prevHead, uint64 at, address by, string category))",
]);

export type Anchored = {
  txHash: string;
  blockNumber: number;
  gasUsed: number;
  gasPriceWei: string;
  costWei: string;
  assayHash: string;
  category: string;
  explorer: string;
};

/** keccak over the canonical bytes of the report, so a verifier can recompute it. */
export function assayHash(canonical: string): string {
  return keccak256(toUtf8Bytes(canonical));
}

export async function anchor(privateKey: string, hash: string, category: string): Promise<Anchored> {
  const wallet = new Wallet(privateKey);
  const data = anchorAbi.encodeFunctionData("anchor", [hash, category]);

  const [nonceHex, gasPriceHex] = await Promise.all([
    rpc<string>("eth_getTransactionCount", [wallet.address, "pending"]),
    rpc<string>("eth_gasPrice"),
  ]);

  const gasHex = await rpc<string>("eth_estimateGas", [{ from: wallet.address, to: ASSAY_ANCHOR, data }]);
  const gasLimit = (BigInt(gasHex) * 12n) / 10n;

  const signed = await wallet.signTransaction({
    chainId: CHAIN_ID,
    to: ASSAY_ANCHOR,
    data,
    nonce: Number(BigInt(nonceHex)),
    gasPrice: BigInt(gasPriceHex),
    gasLimit,
    value: 0n,
  });

  const txHash = await sendRaw(signed);
  const receipt = await waitForReceipt(txHash);
  if (BigInt(receipt.status) !== 1n) throw new Error(`anchor reverted: ${txHash}`);

  const gasUsed = Number(BigInt(receipt.gasUsed));
  const costWei = BigInt(receipt.gasUsed) * BigInt(gasPriceHex);

  return {
    txHash,
    blockNumber: Number(BigInt(receipt.blockNumber)),
    gasUsed,
    gasPriceWei: BigInt(gasPriceHex).toString(),
    costWei: costWei.toString(),
    assayHash: hash,
    category,
    explorer: explorerTx(txHash),
  };
}

export async function onChainHead(): Promise<{ stored: string; recomputed: string; count: number; agree: boolean }> {
  const [storedRaw, recomputedRaw, countRaw] = await Promise.all([
    ethCall(ASSAY_ANCHOR, anchorAbi.encodeFunctionData("head")),
    ethCall(ASSAY_ANCHOR, anchorAbi.encodeFunctionData("recomputeHead")),
    ethCall(ASSAY_ANCHOR, anchorAbi.encodeFunctionData("count")),
  ]);
  const stored = String(anchorAbi.decodeFunctionResult("head", storedRaw)[0]);
  const recomputed = String(anchorAbi.decodeFunctionResult("recomputeHead", recomputedRaw)[0]);
  const count = Number(anchorAbi.decodeFunctionResult("count", countRaw)[0]);
  return { stored, recomputed, count, agree: stored === recomputed };
}

export async function anchorAt(index: number) {
  const raw = await ethCall(ASSAY_ANCHOR, anchorAbi.encodeFunctionData("get", [index]));
  const row = anchorAbi.decodeFunctionResult("get", raw)[0];
  return {
    assayHash: String(row[0]),
    prevHead: String(row[1]),
    at: Number(row[2]),
    by: String(row[3]),
    category: String(row[4]),
  };
}

export const RPC_IN_USE = ENDPOINTS[0];
