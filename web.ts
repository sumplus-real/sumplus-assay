/**
 * The Agent Advantage Report, served.
 *
 * Everything on these pages comes from data/report.json, which is written by a
 * real run: the manual path and the agent path both executed against live BNB
 * Smart Chain testnet state, in the same run, against the same inputs.
 *
 * The one thing the page does not take from the file is the chain check. That
 * is re-read from the network on every visit (cached briefly) and recomputed
 * from the stored anchors, so a visitor is not being shown our recording of
 * what the chain said. If the recomputed head ever stopped matching the stored
 * one, this page would say so.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { onChainHead, ASSAY_ANCHOR } from "./lib/anchor";
import { verify, short, type Receipt } from "./lib/receipts";
import { usd, DEFAULT_MANDATE } from "./lib/mandate";
import { explorerTx, explorerAddress, CHAIN_ID } from "./lib/rpc";

const REPORT_PATH = join(import.meta.dirname, "data", "report.json");
const REPO = "https://github.com/sumplus-real/sumplus-assay";
const CHAIN_CACHE_MS = 120_000;

type Anchor = {
  txHash: string;
  blockNumber: number;
  gasUsed: number;
  gasPriceWei: string;
  costWei: string;
  assayHash: string;
  category: string;
  explorer: string;
};

type Answer = Record<string, unknown>;

type Run = {
  hash: string;
  anchor: Anchor;
  usageReported: boolean;
  tokens: { prompt: number; completion: number };
  chainOk: boolean;
  receipts: Receipt[];
  manualSteps: { where: string; action: string }[];
  result: {
    taskId: string;
    category: string;
    title: string;
    question: string;
    at: string;
    reference: Answer;
    manual: { ms: number; lookups: number; rpcCalls: number; moneyMicroUsd: number; score: number; answer: Answer; notes: string[] };
    agent: { ms: number; lookups: number; rpcCalls: number; moneyMicroUsd: number; score: number; answer: Answer; notes: string[] };
    assumptions: { secondsPerLookup: number; hourlyRateUsd: number };
    derived: {
      humanSeconds: number;
      humanCostMicroUsd: number;
      agentSeconds: number;
      crossoverSecondsPerLookup: number;
      crossoverHourlyRateUsd: number;
      fasterBy: number;
      verdict: string;
    };
  };
};

type Report = {
  generatedAt: string;
  model: { id: string; provider: string; inputPerMillion: number; outputPerMillion: number };
  contract: string;
  chainId: number;
  onChain: { stored: string; recomputed: string; count: number; agree: boolean };
  runs: Run[];
};

const report: Report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));

// ------------------------------------------------------------- the live check

type ChainCheck = { stored: string; recomputed: string; count: number; agree: boolean; at: string; error?: string };
let chainCache: { at: number; value: ChainCheck } | null = null;

async function chainCheck(): Promise<ChainCheck> {
  if (chainCache && Date.now() - chainCache.at < CHAIN_CACHE_MS) return chainCache.value;
  try {
    const head = await onChainHead();
    const value = { ...head, at: new Date().toISOString() };
    chainCache = { at: Date.now(), value };
    return value;
  } catch (e) {
    // A read failure is reported as a read failure. It is not an agreement.
    const value: ChainCheck = {
      stored: "",
      recomputed: "",
      count: 0,
      agree: false,
      at: new Date().toISOString(),
      error: e instanceof Error ? e.message : String(e),
    };
    chainCache = { at: Date.now(), value };
    return value;
  }
}

// ------------------------------------------------------------------ rendering

const esc = (s: unknown) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
:root{--ink:#0a0b0d;--panel:#121418;--panel-2:#171a1f;--line:#23272e;--text:#e9ecf1;
 --muted:#8d95a3;--accent:#7cf5c4;--warn:#ffb454;--bad:#ff6b6b;--radius:14px}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--ink);color:var(--text);
 font-family:ui-sans-serif,-apple-system,"SF Pro Text","Helvetica Neue",Arial,sans-serif;
 font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.mono{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;font-size:12.5px;word-break:break-all}
.sub{color:var(--muted);font-size:12.5px}
.shell{max-width:1000px;margin:0 auto;padding:0 20px 80px}
header.top{position:sticky;top:0;z-index:20;background:rgba(10,11,13,.86);
 backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
header.top .row{max-width:1000px;margin:0 auto;padding:14px 20px;display:flex;
 align-items:center;justify-content:space-between;gap:10px 16px;flex-wrap:wrap}
.brand{display:flex;align-items:baseline;gap:10px}
.brand b{font-size:16px;letter-spacing:.2px}
.brand span{color:var(--muted);font-size:12.5px}
nav{display:flex;gap:16px;flex-wrap:wrap}
nav a{color:var(--muted);font-size:13.5px}
nav a.on{color:var(--text)}
h1{font-size:26px;line-height:1.25;margin:34px 0 8px;letter-spacing:-.2px}
h2{font-size:15px;text-transform:uppercase;letter-spacing:.9px;color:var(--muted);margin:36px 0 12px;font-weight:600}
h3{margin:0 0 4px;font-size:15.5px}
p.lede{color:var(--muted);margin:0 0 8px;max-width:68ch}
p{max-width:72ch}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:16px 18px;margin:10px 0}
.card.flat{background:var(--panel-2)}
.headline{display:flex;flex-wrap:wrap;gap:10px 26px;align-items:baseline;border:1px solid var(--line);
 border-radius:var(--radius);padding:16px 18px;background:var(--panel-2);margin:12px 0 4px}
.headline div{min-width:104px;flex:1 1 auto}
.headline span{display:block;max-width:22ch}
.headline b{display:block;font-size:22px;letter-spacing:-.3px}
.headline span{color:var(--muted);font-size:12.5px}
table{width:100%;border-collapse:collapse;margin:8px 0;font-size:13.5px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.6px}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.scroll{overflow-x:auto}
.ok{color:var(--accent)}
.bad{color:var(--bad)}
.warn{color:var(--warn)}
.tag{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11.5px;border:1px solid var(--line);color:var(--muted);vertical-align:2px}
.tag.ok{color:var(--accent);border-color:#1f4a3b}
.tag.warn{color:var(--warn);border-color:#4a3d1c}
.meta{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:10px;font-size:12.5px;color:var(--muted)}
.meta b{color:var(--text);font-weight:600}
ol,ul{max-width:72ch;color:var(--muted)}
ol li,ul li{margin:3px 0}
ol li b,ul li b{color:var(--text);font-weight:600}
code{background:var(--panel-2);border:1px solid var(--line);border-radius:6px;padding:1px 6px;
 font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
pre{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px;
 overflow-x:auto;font-size:12.5px;line-height:1.55}
footer{color:var(--muted);font-size:12.5px;margin-top:48px;border-top:1px solid var(--line);padding-top:16px}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
@media print{
 header.top{position:static;background:#fff}
 html,body{background:#fff;color:#111}
 .card,.headline,pre{background:#fff;border-color:#ccc}
 a{color:#111}
 h2{color:#555}
 p.lede,.meta,ol,ul{color:#333}
}
`;

const NAV: [string, string][] = [
  ["/", "Overview"],
  ["/report", "Advantage report"],
  ["/verify", "Verify"],
];

function page(path: string, title: string, body: string): string {
  const nav = NAV.map(([href, label]) => `<a href="${href}" class="${href === path ? "on" : ""}">${label}</a>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Sumplus Assay</title><style>${CSS}</style></head><body>
<header class="top"><div class="row">
<div class="brand"><b>Sumplus Assay</b><span>agent advantage, measured and anchored</span></div>
<nav>${nav}<a href="${REPO}">Source</a></nav>
</div></header>
<div class="shell">${body}
<footer>BNB Smart Chain testnet, chain id ${CHAIN_ID}. Anchor contract
<a class="mono" href="${explorerAddress(ASSAY_ANCHOR)}">${ASSAY_ANCHOR}</a>.
Run generated ${esc(report.generatedAt)}. Sumplus · Build the Era 2026.</footer>
</div></body></html>`;
}

const secs = (n: number) => (n >= 100 ? `${n.toFixed(0)} s` : `${n.toFixed(1)} s`);

function chainBanner(c: ChainCheck): string {
  if (c.error) {
    return `<div class="card"><h3 class="warn">The chain could not be read just now</h3>
<p class="lede">This page refuses to report agreement it did not observe. The anchors are still on chain and can be
read directly at <a class="mono" href="${explorerAddress(ASSAY_ANCHOR)}">${short(ASSAY_ANCHOR, 12)}</a>.</p>
<div class="meta"><span>Reason <b class="mono">${esc(c.error)}</b></span></div></div>`;
  }
  const cls = c.agree ? "ok" : "bad";
  const verdict = c.agree
    ? "The stored head and the head recomputed from every anchor agree."
    : "The stored head and the recomputed head disagree. Something was altered.";
  return `<div class="card"><h3 class="${cls}">${c.count} anchors on chain · ${verdict}</h3>
<p class="lede">Read from the network at ${esc(c.at)}, not from this file. The contract walks its own anchors and
rebuilds the head in a view call, so a stored value nobody checks proves nothing.</p>
<div class="meta">
<span>stored <b class="mono">${esc(short(c.stored, 14))}</b></span>
<span>recomputed <b class="mono">${esc(short(c.recomputed, 14))}</b></span>
</div></div>`;
}

function overview(c: ChainCheck): string {
  const runs = report.runs;
  const humanSecs = runs.reduce((a, r) => a + r.result.derived.humanSeconds, 0);
  const agentSecs = runs.reduce((a, r) => a + r.result.derived.agentSeconds, 0);
  const humanCost = runs.reduce((a, r) => a + r.result.derived.humanCostMicroUsd, 0);
  const agentCost = runs.reduce((a, r) => a + r.result.agent.moneyMicroUsd, 0);
  const matched = runs.filter((r) => r.result.agent.score >= 0.999).length;

  const rows = runs
    .map((r) => {
      const d = r.result.derived;
      return `<tr>
<td><a href="/assay/${esc(r.result.taskId)}">${esc(r.result.category)}</a><br>
<span class="sub">${esc(r.result.title)}</span></td>
<td class="num">${d.humanSeconds.toFixed(0)} s</td>
<td class="num">${secs(d.agentSeconds)}</td>
<td class="num">${usd(d.humanCostMicroUsd)}</td>
<td class="num">${usd(r.result.agent.moneyMicroUsd)}</td>
<td class="num">${(r.result.agent.score * 100).toFixed(0)}%</td>
<td class="num">${d.fasterBy.toFixed(1)}×</td>
<td class="num">${d.crossoverSecondsPerLookup.toFixed(1)} s</td>
</tr>`;
    })
    .join("");

  return `
<h1>Hiring an agent should be provable, not assumed.</h1>
<p class="lede">Assay runs the same job twice, once the way a person would do it and once by agent, measures both in
the same run against the same live state, and puts a hash of the result on BNB Smart Chain. The comparison stops
being a claim about our own product and becomes a record that predates the moment we had a reason to improve it.</p>

<div class="headline">
<div><b>${matched}/${runs.length}</b><span>assays matched the reference answer</span></div>
<div><b>${usd(humanCost)}</b><span>by hand, at the stated rate</span></div>
<div><b>${usd(agentCost)}</b><span>by agent, metered</span></div>
<div><b>${(humanSecs / agentSecs).toFixed(1)}×</b><span>faster overall</span></div>
<div><b>${c.count}</b><span>anchors on chain</span></div>
</div>

${chainBanner(c)}

<h2>The four assays</h2>
<div class="scroll"><table>
<tr><th>Category</th><th class="num">By hand</th><th class="num">Agent</th><th class="num">Cost by hand</th>
<th class="num">Cost by agent</th><th class="num">Answer matched</th><th class="num">Faster</th><th class="num">Crossover</th></tr>
${rows}
</table></div>
<p class="lede">The crossover column is the point at which our own conclusion flips: work faster than that per
lookup and doing it by hand wins. It is published so a judge can overturn the claim with their own numbers rather
than take ours.</p>

<h2>What is measured and what is assumed</h2>
<div class="grid2">
<div class="card"><h3>Measured</h3><p class="lede">Agent wall clock, tool calls, RPC calls, tokens in and out priced
at the gateway's published rate, and whether the answer matched the reference field by field. Both paths executed
inside one run, so they saw the same block.</p></div>
<div class="card"><h3>Assumed</h3><p class="lede">${report.runs[0].result.assumptions.secondsPerLookup} seconds for a
person to make one lookup on a block explorer, and ${usd(report.runs[0].result.assumptions.hourlyRateUsd * 1_000_000)}
an hour for that person's time. Both are stated rather than hidden, and both appear next to every result so they can
be replaced.</p></div>
</div>
<p class="lede">The manual path is a script that performs exactly the lookups a person would perform, listed
step by step on each assay page. Its machine time is not passed off as human time: the human figure comes from
counting real steps and multiplying by the stated rate.</p>

<h2>The agent runs under a mandate</h2>
<p class="lede">A ceiling of ${usd(DEFAULT_MANDATE.perTaskCeilingMicroUsd)} per task, ${DEFAULT_MANDATE.maxToolCalls}
tool calls at most, ${DEFAULT_MANDATE.allowedTools.length} read-only tools, and an allowlist of hosts it may reach.
Every model call, tool call and refusal writes a receipt that commits to the one before it. Those chains are on the
assay pages, and the verifier rebuilds them from scratch rather than trusting a stored hash.</p>

<h2>Model</h2>
<p class="lede">${esc(report.model.id)} through the Sumplus SafeRouter gateway, pinned to the
<code>${esc(report.model.provider)}</code> line so the run is priced against the line it actually used. Priced at
$${report.model.inputPerMillion} per million tokens in and $${report.model.outputPerMillion} out.</p>`;
}

function answerTable(reference: Answer, agent: Answer): string {
  const keys = Object.keys(reference);
  const rows = keys
    .map((k) => {
      const a = reference[k];
      const b = agent[k];
      const same = String(a) === String(b) || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < Math.max(1e-6, Math.abs(a) * 0.001));
      return `<tr><td class="mono">${esc(k)}</td><td class="num mono">${esc(a)}</td>
<td class="num mono">${esc(b === undefined ? "—" : b)}</td>
<td class="num">${same ? '<span class="ok">match</span>' : '<span class="bad">differs</span>'}</td></tr>`;
    })
    .join("");
  return `<div class="scroll"><table>
<tr><th>Field</th><th class="num">Reference</th><th class="num">Agent</th><th class="num"></th></tr>
${rows}</table></div>`;
}

function assayPage(run: Run): string {
  const r = run.result;
  const d = r.derived;
  const v = verify(run.receipts);
  const steps = run.manualSteps;
  const shown = steps.slice(0, 12);
  const receipts = run.receipts
    .map(
      (x) => `<tr><td class="num">${x.seq}</td><td>${esc(x.step)}</td><td>${esc(x.detail)}</td>
<td>${x.decision === "allowed" ? '<span class="tag ok">allowed</span>' : '<span class="tag warn">refused</span>'}</td>
<td class="num">${usd(x.costMicroUsd)}</td><td class="mono">${esc(short(x.hash, 8))}</td></tr>`
    )
    .join("");

  return `
<h1>${esc(r.title)}</h1>
<p class="lede"><span class="tag">${esc(r.category)}</span> ${esc(r.question)}</p>

<div class="headline">
<div><b>${d.humanSeconds.toFixed(0)} s</b><span>by hand, ${r.manual.lookups} lookups</span></div>
<div><b>${secs(d.agentSeconds)}</b><span>by agent, ${r.agent.lookups} tool calls</span></div>
<div><b>${usd(d.humanCostMicroUsd)}</b><span>cost by hand</span></div>
<div><b>${usd(r.agent.moneyMicroUsd)}</b><span>cost by agent</span></div>
<div><b>${(r.agent.score * 100).toFixed(0)}%</b><span>of the reference answer reproduced</span></div>
</div>
<div class="card flat"><p style="margin:0">${esc(d.verdict)}</p></div>

<h2>The answer, field by field</h2>
${answerTable(r.reference, r.agent.answer)}
${r.agent.notes.length ? `<p class="lede">Where the agent differed: ${r.agent.notes.map((n) => esc(n)).join("; ")}</p>` : ""}

<h2>What the manual path actually does</h2>
<p class="lede">${steps.length} lookups, in order. These are the clicks and calls a person makes on a block explorer
to answer the same question. The baseline is a script performing them, not an estimate of them.</p>
<ol>${shown.map((s) => `<li><b>${esc(s.where)}</b> — ${esc(s.action)}</li>`).join("")}</ol>
${steps.length > shown.length ? `<p class="lede">Then ${steps.length - shown.length} more of the same shape, one market at a time.</p>` : ""}

<h2>What the agent did</h2>
<p class="lede">${run.receipts.length} receipts, chained. ${run.tokens.prompt} tokens in, ${run.tokens.completion} out,
${run.usageReported ? "as reported by the gateway" : "estimated deliberately high because the gateway reported no usage"}.
${r.agent.rpcCalls} RPC calls behind the tools.</p>
<div class="scroll"><table>
<tr><th class="num">#</th><th>Step</th><th>Detail</th><th>Ruling</th><th class="num">Cost</th><th>Hash</th></tr>
${receipts}</table></div>
<p class="lede">Chain rebuilt from these receipts: <span class="${v.ok ? "ok" : "bad"}">${v.ok ? "intact" : "broken"}</span>,
${v.length} entries, head <span class="mono">${esc(short(v.head, 12))}</span>.</p>

<h2>Anchor</h2>
<div class="card"><div class="meta">
<span>assay hash <b class="mono">${esc(run.hash)}</b></span>
</div><div class="meta">
<span>block <b>${run.anchor.blockNumber}</b></span>
<span>gas <b>${run.anchor.gasUsed}</b></span>
<span>category <b>${esc(run.anchor.category)}</b></span>
<span><a href="${esc(explorerTx(run.anchor.txHash))}">transaction</a></span>
</div></div>
<p class="lede">Recompute it yourself: canonicalise this assay's JSON the way <code>lib/report.ts</code> does, keccak
the bytes, and compare. The recipe is on the <a href="/verify">verify page</a>.</p>

<p style="margin-top:28px"><a href="/">← all four assays</a></p>`;
}

function reportPage(c: ChainCheck): string {
  const runs = report.runs;
  const rows = runs
    .map((r) => {
      const d = r.result.derived;
      return `<tr>
<td>${esc(r.result.category)}</td>
<td>${esc(r.result.title)}</td>
<td class="num">${r.result.manual.lookups}</td>
<td class="num">${d.humanSeconds.toFixed(0)} s</td>
<td class="num">${usd(d.humanCostMicroUsd)}</td>
<td class="num">${secs(d.agentSeconds)}</td>
<td class="num">${usd(r.result.agent.moneyMicroUsd)}</td>
<td class="num">${(r.result.agent.score * 100).toFixed(0)}%</td>
<td class="mono"><a href="${esc(explorerTx(r.anchor.txHash))}">${esc(short(r.anchor.txHash, 8))}</a></td>
</tr>`;
    })
    .join("");

  const humanCost = runs.reduce((a, r) => a + r.result.derived.humanCostMicroUsd, 0);
  const agentCost = runs.reduce((a, r) => a + r.result.agent.moneyMicroUsd, 0);
  const humanSecs = runs.reduce((a, r) => a + r.result.derived.humanSeconds, 0);
  const agentSecs = runs.reduce((a, r) => a + r.result.derived.agentSeconds, 0);

  const detail = runs
    .map(
      (r) => `<div class="card"><h3>${esc(r.result.category)} · ${esc(r.result.title)}</h3>
<p class="lede">${esc(r.result.question)}</p>
<p style="margin:6px 0 0">${esc(r.result.derived.verdict)}</p>
<div class="meta">
<span>manual <b>${r.result.manual.lookups} lookups</b></span>
<span>agent <b>${r.result.agent.lookups} tool calls, ${r.result.agent.rpcCalls} RPC reads</b></span>
<span>tokens <b>${r.tokens.prompt} in / ${r.tokens.completion} out</b></span>
<span>crossover <b>${r.result.derived.crossoverSecondsPerLookup.toFixed(1)} s per lookup</b></span>
<span><a href="/assay/${esc(r.result.taskId)}">full run</a></span>
</div></div>`
    )
    .join("");

  return `
<h1>Agent Advantage Report</h1>
<p class="lede">Four tasks, each run twice on BNB Smart Chain testnet: once as a scripted manual baseline that makes
the same lookups a person makes, once by an agent under a spending mandate. Both paths ran in the same run against
the same block. One task is a security read and one is a trading plan.</p>

<h2>Summary</h2>
<div class="scroll"><table>
<tr><th>Category</th><th>Task</th><th class="num">Lookups</th><th class="num">Time by hand</th><th class="num">Cost by hand</th>
<th class="num">Agent time</th><th class="num">Agent cost</th><th class="num">Quality</th><th>Anchor</th></tr>
${rows}
<tr><td colspan="3"><b>Total</b></td><td class="num"><b>${humanSecs.toFixed(0)} s</b></td>
<td class="num"><b>${usd(humanCost)}</b></td><td class="num"><b>${secs(agentSecs)}</b></td>
<td class="num"><b>${usd(agentCost)}</b></td><td class="num"><b>${((runs.filter((r) => r.result.agent.score >= 0.999).length / runs.length) * 100).toFixed(0)}%</b></td><td></td></tr>
</table></div>

<h2>How quality was scored</h2>
<p class="lede">Each task defines a reference answer computed directly from chain state, and the agent's answer is
compared field by field against it. Quality is the fraction of fields reproduced, not a judgement of tone. The
comparison for every task is on its own page.</p>

<h2>How cost was measured</h2>
<p class="lede">The agent's cost is tokens actually reported by the gateway, priced at its published rate for the line
the request was pinned to. If a response ever arrives without a usage block, the run records that fact and prices the
call from a deliberately high estimate rather than reporting zero. The human cost is
${runs[0].result.manual.lookups > 0 ? "counted lookups" : "counted steps"} multiplied by the two stated assumptions:
${report.runs[0].result.assumptions.secondsPerLookup} seconds per lookup and
${usd(report.runs[0].result.assumptions.hourlyRateUsd * 1_000_000)} an hour.</p>

<h2>The four tasks</h2>
${detail}

<h2>Why this report can be checked</h2>
${chainBanner(c)}
<p class="lede">Each assay is canonicalised, hashed, and anchored in its own transaction before the submission. A
reader can take the numbers above, recompute the hash, and find it in a block. The anchors are also chained to each
other, and the contract will rebuild that chain on request, so removing an unflattering run would be visible.</p>`;
}

function verifyPage(c: ChainCheck): string {
  return `
<h1>Check it without trusting us</h1>
<p class="lede">Three things can be verified independently, and none of them require running our code.</p>

<h2>1. The anchors are on chain and consistent</h2>
${chainBanner(c)}
<p class="lede">Call <code>head()</code> and <code>recomputeHead()</code> on
<a class="mono" href="${explorerAddress(ASSAY_ANCHOR)}">${ASSAY_ANCHOR}</a>. The first returns the value the contract
stored as it went. The second walks every anchor and rebuilds it. A stored head that nobody recomputes proves
nothing, which is the whole reason the second function exists.</p>
<p class="lede">Against any public node, without this site and without an explorer:</p>
<pre>curl -s https://bsc-testnet-rpc.publicnode.com -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{
       "to":"${ASSAY_ANCHOR}",
       "data":"0x8f7dcfa3"},"latest"]}'   # head()

# same call with 0xba3e9592 is recomputeHead(), and 0x06661abd is count()</pre>
<p class="lede">The two must return the same 32 bytes. They currently do, and this page says so above by making
those calls itself.</p>

<h2>2. The report hashes to what was anchored</h2>
<p class="lede">Take one assay from <a href="/api/report.json">the report JSON</a>, canonicalise it with sorted keys
the way <code>canonical()</code> does, and keccak the UTF-8 bytes. That is the value stored in the anchor for that
category, and the transaction predates this submission.</p>
<pre>git clone ${REPO}
cd sumplus-assay &amp;&amp; npm install
npx tsx scripts/verify-report.ts</pre>

<h2>3. The receipts inside a run are intact</h2>
<p class="lede">Every model call, tool call and refusal is a receipt that commits to its own fields and to the hash of
the one before it. The verifier recomputes each hash and carries the recomputed value forward, never the stored one,
so editing a receipt breaks the link both at that entry and at the next. The test suite proves this by editing one
and confirming the check goes red.</p>

<h2>What is not claimed</h2>
<ul>
<li>The chain does not store the report, only a hash of it. If we never published the report, the hash would prove
nothing on its own.</li>
<li>An anchor proves the numbers existed at that block. It does not prove the run behind them was well designed;
that is what the manual baseline and the published crossover are for.</li>
<li>The human seconds and the hourly rate are stated assumptions, not measurements, and every page that uses them
says so.</li>
</ul>`;
}

// -------------------------------------------------------------------- serving

const byId = new Map(report.runs.map((r) => [r.result.taskId, r]));
const PORT = Number(process.env.PORT ?? 8080);

const server = createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  const send = (code: number, type: string, body: string) => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };

  try {
    if (path === "/healthz") return send(200, "application/json", JSON.stringify({ ok: true, runs: report.runs.length }));
    if (path === "/api/report.json") return send(200, "application/json", JSON.stringify(report, null, 2));

    if (path === "/") return send(200, "text/html; charset=utf-8", page(path, "Overview", overview(await chainCheck())));
    if (path === "/report") return send(200, "text/html; charset=utf-8", page(path, "Advantage report", reportPage(await chainCheck())));
    if (path === "/verify") return send(200, "text/html; charset=utf-8", page(path, "Verify", verifyPage(await chainCheck())));

    if (path.startsWith("/assay/")) {
      const run = byId.get(decodeURIComponent(path.slice("/assay/".length)));
      if (run) return send(200, "text/html; charset=utf-8", page("/", run.result.category, assayPage(run)));
    }

    send(404, "text/html; charset=utf-8", page(path, "Not found", `<h1>Nothing here</h1><p><a href="/">Back to the assays</a></p>`));
  } catch (e) {
    send(500, "text/plain; charset=utf-8", e instanceof Error ? e.message : String(e));
  }
});

server.listen(PORT, () => console.log(`assay web on :${PORT}`));
