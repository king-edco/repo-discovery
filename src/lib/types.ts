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
};

export type SearchResult = {
  query: string;
  count: number;
  results: Repo[];
};
