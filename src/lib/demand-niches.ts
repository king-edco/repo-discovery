// Curated set of niche keywords used to probe demand-signal sources.
// Deliberately varied (tech, trading, fitness, content creation, ...) so the
// ingestion exercises a broad slice of each API. Keep the list short (20–30)
// so the Currents daily quota (250 req/day) can cover every niche with a few
// requests to spare — see ingest-demand.ts for the budget split.
export const DEMAND_NICHES: string[] = [
  // Tech / dev tools
  "react native",
  "rust programming",
  "typescript",
  "docker",
  "kubernetes",
  "self-hosted software",
  // AI / data
  "machine learning",
  "large language models",
  "vector database",
  // Trading / finance
  "algorithmic trading",
  "crypto trading bot",
  "personal finance app",
  // Fitness / health
  "home workout",
  "running training",
  "nutrition tracking",
  // Content creation
  "video editing software",
  "podcast recording",
  "youtube growth",
  // Productivity / misc
  "note taking app",
  "habit tracking",
  "indie hacker",
  "no-code platform",
  "open source games",
  "home automation",
  "3d printing",
  "raspberry pi projects",
  "privacy tools",
];
