/**
 * Rule-based section and topic assignment, run at insert time.
 *
 * This is deliberately not AI: every article needs a section the moment it
 * lands, and only ~6% of them will ever be worth an AI call. The source's own
 * section acts as a prior, but strong keyword evidence overrides it — Phoronix
 * is seeded as `os`, yet its GPU benchmark pieces belong in `hardware`.
 */

export const SECTIONS = [
  "ai",
  "software",
  "hardware",
  "consumer",
  "os",
  "security",
  "cloud",
  "science",
  "gaming",
  "industry",
] as const;

export type Section = (typeof SECTIONS)[number];

/** Keyword → weight. Longer, more specific phrases score higher. */
const RULES: Record<Section, [RegExp, number][]> = {
  ai: [
    [/\b(llm|large language model|transformer|diffusion model|neural net\w*)\b/i, 3],
    [/\b(machine learning|deep learning|computer vision|reinforcement learning)\b/i, 3],
    [/\b(gpt|claude|gemini|llama|mistral|stable diffusion|midjourney)\b/i, 2],
    [/\b(fine-?tun\w+|embedding|inference|benchmark\w*|checkpoint|dataset)\b/i, 1],
    [/\b(openai|anthropic|deepmind|hugging ?face|arxiv)\b/i, 2],
    [/\b(ai|ml)\b/i, 1],
  ],
  software: [
    [/\b(rust|golang|typescript|python|java|kotlin|swift|zig|elixir)\b/i, 2],
    [/\b(compiler|runtime|framework|library|sdk|api|open ?source)\b/i, 1],
    [/\b(postgres\w*|sqlite|mysql|redis|database)\b/i, 2],
    [/\b(release[sd]?|version \d|stabilis\w+|deprecat\w+|refactor\w*)\b/i, 1],
    [/\b(git|github|npm|cargo|package manager)\b/i, 1],
  ],
  hardware: [
    [/\b(cpu|gpu|soc|chipset|motherboard|ddr\d|hbm\d?|nvme|ssd)\b/i, 3],
    [/\b(semiconductor|fab|foundry|lithography|nanometer|tsmc|asml)\b/i, 3],
    [/\b(ryzen|zen \d|epyc|xeon|snapdragon|arm|risc-?v|core ultra)\b/i, 2],
    [/\b(benchmark\w*|overclock\w*|thermal|teardown|silicon)\b/i, 1],
    [/\b(server|rack|datacent\w+ hardware|homelab)\b/i, 1],
  ],
  consumer: [
    [/\b(iphone|pixel|galaxy|macbook|thinkpad|ipad|airpods|smartwatch)\b/i, 3],
    [/\b(laptop|smartphone|tablet|headphones?|earbuds|camera|wearable)\b/i, 2],
    [/\b(review|hands-?on|unboxing|first look|battery life)\b/i, 1],
    [/\b(smart home|electric vehicle|\bev\b|matter|thread)\b/i, 2],
  ],
  os: [
    [/\b(linux|kernel|systemd|wayland|x11|gnome|kde|distro)\b/i, 3],
    [/\b(windows ?\d*|macos|android|ios|ipados|freebsd|openbsd|chromeos)\b/i, 3],
    [/\b(filesystem|btrfs|zfs|ext4|scheduler|driver|bootloader)\b/i, 2],
    [/\b(ubuntu|fedora|debian|arch linux|nixos)\b/i, 2],
  ],
  security: [
    [/\b(cve-\d{4}-\d+|zero-?day|exploit|vulnerabilit\w+|rce\b)\b/i, 4],
    [/\b(breach|ransomware|malware|phishing|backdoor|botnet)\b/i, 3],
    [/\b(encryption|cryptograph\w+|post-?quantum|tls|authentication)\b/i, 2],
    [/\b(patch\w*|advisory|disclosure|cisa|security)\b/i, 1],
  ],
  cloud: [
    [/\b(kubernetes|k8s|docker|container|serverless|terraform)\b/i, 3],
    [/\b(aws|azure|gcp|google cloud|cloudflare|vercel|fly\.io)\b/i, 2],
    [/\b(devops|ci\/cd|observability|outage|postmortem|sre)\b/i, 2],
    [/\b(datacent\w+|edge comput\w+|load balanc\w+)\b/i, 1],
  ],
  science: [
    [/\b(quantum|qubit|superconduct\w+|photonic)\b/i, 3],
    [/\b(nasa|spacex|rocket|orbit|telescope|satellite)\b/i, 3],
    [/\b(physics|materials science|fusion|biotech|genome)\b/i, 2],
    [/\b(research\w*|study|paper|peer[- ]review\w*)\b/i, 1],
  ],
  gaming: [
    [/\b(steam|playstation|xbox|nintendo|switch \d?|valve|proton)\b/i, 3],
    [/\b(game engine|unreal|unity|godot|vulkan|directx|ray trac\w+)\b/i, 2],
    [/\b(gam(?:e|ing)\b|esports|speedrun)\b/i, 1],
  ],
  industry: [
    [/\b(tariffs?|export controls?|sanctions?|trade (?:war|ban|restrictions?))\b/i, 4],
    [/\b(crack(?:s|ed|ing)? down|crackdown|investigations?|convictions?)\b/i, 3],
    [/\b(ownership|state[- ]owned|subsidy|subsidies|chips act|national security)\b/i, 3],
    [/\b(acquisition|merger|ipo|funding round|series [a-e]\b|valuation)\b/i, 3],
    [/\b(antitrust|regulat\w+|lawsuit|settlement|ftc|doj|European Commission)\b/i, 3],
    [/\b(layoffs?|earnings|revenue|quarterly|market share)\b/i, 2],
    [/\b(startup|venture capital|billion|policy)\b/i, 1],
  ],
};

/** Sub-topics surfaced as filter chips on a section page. */
const TOPICS: [RegExp, string][] = [
  [/\bcomputer vision\b/i, "computer vision"],
  [/\b(llm|large language model)\b/i, "language models"],
  [/\bdeep learning|neural net\w*\b/i, "deep learning"],
  [/\brobotic?s?\b/i, "robotics"],
  [/\bkernel\b/i, "kernel"],
  [/\bwayland|x11\b/i, "wayland"],
  [/\bwindows ?\d*\b/i, "windows"],
  [/\bmacos|ios\b/i, "apple"],
  [/\bandroid\b/i, "android"],
  [/\b(cve-\d{4}-\d+|zero-?day)\b/i, "vulnerabilities"],
  [/\bgpu|graphics card\b/i, "gpu"],
  [/\bcpu|processor\b/i, "cpu"],
  [/\bquantum\b/i, "quantum"],
  [/\bkubernetes|k8s\b/i, "kubernetes"],
  [/\brust\b/i, "rust"],
  [/\bpostgres\w*\b/i, "postgres"],
];

export type Classification = {
  section: Section;
  topics: string[];
  score: number; // 0–100
};

export type ClassifyInput = {
  title: string;
  excerpt?: string | null;
  sourceSection: string;
  sourceWeight: number;
  publishedAt?: number | null;
  engagement?: number;
  now?: number;
};

export function classify(input: ClassifyInput): Classification {
  const haystack = `${input.title} ${input.excerpt ?? ""}`;

  const scores = new Map<Section, number>();
  for (const section of SECTIONS) {
    let total = 0;
    for (const [pattern, weight] of RULES[section]) {
      if (pattern.test(haystack)) total += weight;
    }
    scores.set(section, total);
  }

  // The source's own section is a prior, not a verdict: worth about one strong
  // keyword, so clear evidence in the text can outvote it.
  const prior = SECTIONS.includes(input.sourceSection as Section)
    ? (input.sourceSection as Section)
    : "software";
  scores.set(prior, (scores.get(prior) ?? 0) + 2.5);

  let section: Section = prior;
  let best = -1;
  for (const candidate of SECTIONS) {
    const value = scores.get(candidate) ?? 0;
    if (value > best) {
      best = value;
      section = candidate;
    }
  }

  const topics = TOPICS.filter(([pattern]) => pattern.test(haystack)).map(([, name]) => name);

  return { section, topics: [...new Set(topics)], score: heuristicScore(input, best) };
}

/**
 * A cheap 0–100 stand-in for editorial judgement, used to rank the feed and to
 * decide what is worth spending an AI call on.
 */
function heuristicScore(input: ClassifyInput, keywordStrength: number): number {
  const now = input.now ?? Math.floor(Date.now() / 1000);

  // Source trust, 0.3–2.0 → 0–35.
  const trust = Math.min(input.sourceWeight, 2) / 2;

  // Exponential decay, 18-hour half-life.
  const ageHours = input.publishedAt ? Math.max(0, (now - input.publishedAt) / 3600) : 12;
  const recency = 2 ** (-ageHours / 18);

  // Engagement is long-tailed, so compress it.
  const engagement = Math.min(Math.log10((input.engagement ?? 0) + 1) / 3, 1);

  // Topical confidence.
  const topical = Math.min(keywordStrength / 8, 1);

  const score = trust * 35 + recency * 30 + topical * 20 + engagement * 15;
  return Math.round(Math.max(0, Math.min(100, score)));
}
