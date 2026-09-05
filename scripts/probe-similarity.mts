import { compareTitles } from "../app/lib/cluster/similarity.js";

const PAIRS: [string, string, string][] = [
  [
    "same story, near-identical",
    "AMD Reportedly Prepares New Ryzen 5 7500 Six-Core CPU for AM5 Socket",
    "AMD reportedly prepares new Ryzen 5 7500 six-core CPU for AM5 socket",
  ],
  [
    "same story, light reword",
    "Linux 6.19 merge window opens with the scheduler rewrite landing",
    "Linux 6.19 merge window opens, scheduler rewrite lands",
  ],
  [
    "same story, heavy reword",
    "EU begins enforcing the AI Act against general-purpose models",
    "European Commission opens AI Act enforcement for foundation models",
  ],
  [
    "same story, different angle",
    "Signal ships a post-quantum ratchet to every client",
    "Signal rolls out post-quantum encryption across all platforms",
  ],
  [
    "different, same company",
    "Nvidia announces its next datacentre GPU",
    "Nvidia delays its consumer graphics refresh",
  ],
  [
    "different CVEs",
    "CVE-2026-31847: unauthenticated RCE in ScreenConnect",
    "CVE-2026-31999: privilege escalation in ScreenConnect",
  ],
  [
    "different, shared vocabulary",
    "Rust 1.94 stabilises async closures",
    "Rust 1.95 stabilises const generics",
  ],
];

for (const [label, a, b] of PAIRS) {
  const { score, verdict } = compareTitles(a, b);
  console.log(`${score.toFixed(3)}  ${verdict.padEnd(9)}  ${label}`);
}
