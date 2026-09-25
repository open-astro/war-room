export interface PullRequest {
  /** "owner/name" */
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  mergedAt: string; // ISO 8601
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: string[];
  /** Plain-English summary. Null until generated. */
  summary: string | null;
  /** Broad category chosen by the summarizer. */
  category: Category | null;
  /** SHA-1 of title+body at summary time, so an edited PR gets re-summarized. */
  summaryHash: string | null;
}

export type Category =
  | "feature"
  | "fix"
  | "refactor"
  | "tests"
  | "docs"
  | "ci"
  | "chore";

export interface Dataset {
  generatedAt: string;
  repos: string[];
  prs: PullRequest[];
}
