/**
 * Replays the measured bge-small cosines through the identifier guard, to show
 * what the guard buys before it ships. Scores are from scripts/probe-embeddings
 * run against real Workers AI on 2026-09-05.
 */
import { discriminatorsConflict } from "../app/lib/cluster/discriminators.js";

const MEASURED: [
  score: number,
  verdict: "same" | "different",
  label: string,
  a: string,
  b: string,
][] = [
  [
    1.0,
    "same",
    "near-identical",
    "AMD Reportedly Prepares New Ryzen 5 7500 Six-Core CPU for AM5 Socket",
    "AMD reportedly prepares new Ryzen 5 7500 six-core CPU for AM5 socket",
  ],
  [
    0.98,
    "same",
    "light reword",
    "Linux 6.19 merge window opens with the scheduler rewrite landing",
    "Linux 6.19 merge window opens, scheduler rewrite lands",
  ],
  [
    0.901,
    "same",
    "headline vs consequence",
    "Broadcom raises VMware perpetual licence prices again",
    "VMware customers face another Broadcom price increase",
  ],
  [
    0.878,
    "same",
    "heavy reword",
    "EU begins enforcing the AI Act against general-purpose models",
    "European Commission opens AI Act enforcement for foundation models",
  ],
  [
    0.853,
    "different",
    "two CVEs, one product",
    "CVE-2026-31847: unauthenticated RCE in ScreenConnect",
    "CVE-2026-31999: privilege escalation in ScreenConnect",
  ],
  [
    0.825,
    "same",
    "different angle",
    "Signal ships a post-quantum ratchet to every client",
    "Signal rolls out post-quantum encryption across all platforms",
  ],
  [
    0.793,
    "different",
    "consecutive versions",
    "Apple releases iOS 26.2 with security fixes",
    "Apple releases iOS 26.3 with a redesigned Control Centre",
  ],
  [
    0.787,
    "different",
    "adjacent releases",
    "Rust 1.94 stabilises async closures",
    "Rust 1.95 stabilises const generics",
  ],
  [
    0.783,
    "same",
    "announcement vs analysis",
    "OpenAI launches GPT-5.5 with improved reasoning",
    "OpenAI's new model tops every reasoning benchmark we ran",
  ],
  [
    0.764,
    "different",
    "same quarter, two companies",
    "Microsoft reports a Q3 earnings beat on Azure growth",
    "Alphabet reports a Q3 earnings beat on cloud growth",
  ],
  [
    0.716,
    "different",
    "same company, two stories",
    "Nvidia announces its next datacentre GPU",
    "Nvidia delays its consumer graphics refresh",
  ],
  [
    0.595,
    "different",
    "same event type, two companies",
    "Google lays off 200 staff in its cloud division",
    "Amazon cuts 300 roles at AWS",
  ],
];

console.log("score  truth      guard    label");
const survivors: typeof MEASURED = [];
for (const row of MEASURED) {
  const [score, verdict, label, a, b] = row;
  const blocked = discriminatorsConflict(a, b);
  const mark = blocked ? (verdict === "different" ? "BLOCK ✓" : "BLOCK ✗") : "  --   ";
  console.log(`${score.toFixed(3)}  ${verdict.padEnd(9)}  ${mark}  ${label}`);
  if (!blocked) survivors.push(row);
}

const pos = survivors.filter((r) => r[1] === "same").map((r) => r[0]);
const neg = survivors.filter((r) => r[1] === "different").map((r) => r[0]);
const worstPos = Math.min(...pos);
const bestNeg = Math.max(...neg);
console.log(
  `\nafter the guard — worst positive ${worstPos.toFixed(3)}, best negative ${bestNeg.toFixed(3)}`,
);
console.log(
  worstPos > bestNeg
    ? `SEPARABLE: any threshold in (${bestNeg.toFixed(3)}, ${worstPos.toFixed(3)}] splits every pair correctly`
    : "still overlapping",
);
for (const t of [0.78, 0.8, 0.82, 0.85, 0.88]) {
  const tp = pos.filter((s) => s >= t).length;
  const fp = neg.filter((s) => s >= t).length;
  console.log(`  threshold ${t.toFixed(2)} -> ${tp}/${pos.length} merged, ${fp} false merge(s)`);
}
