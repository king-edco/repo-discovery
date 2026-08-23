// Shared repo shape returned by /api/repos and used by /api/search results.

export type Repo = {
  id: string;
  name: string;
  full_name: string;
  description: string | null;
  url: string;
  stars: number;
  language: string | null;
  license: string | null;
  readme_text?: string | null;
  topics: string;
  pushed_at: string;
  ingested_at: string;
  similarity?: number;
  commercialScore?: number;
  // AI enrichment (cached on the repos row, served via /api/repos/[id]/enrichment)
  plain_summary?: string | null;
  business_pitch?: string | null;
  // Recommendation-engine fields (only present in /api/recommend responses)
  recScore?: number;
  interestMatch?: number;
  semanticScore?: number;
  liked?: boolean;
  disliked?: boolean;
};

export type SearchResult = {
  query: string;
  count: number;
  results: Repo[];
};
