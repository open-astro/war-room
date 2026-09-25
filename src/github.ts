import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Raw shape returned by `gh pr list --json`. */
export interface RawPr {
  number: number;
  title: string;
  body: string;
  url: string;
  author: { login: string };
  mergedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: { name: string }[];
}

const FIELDS =
  "number,title,body,url,author,mergedAt,additions,deletions,changedFiles,labels";

/**
 * Fetch merged PRs for one repo via the gh CLI.
 * gh handles auth (local login or GITHUB_TOKEN in Actions) and pagination.
 * `since` limits the search to PRs merged on/after that date (YYYY-MM-DD).
 */
export async function fetchMergedPrs(
  repo: string,
  since?: string,
): Promise<RawPr[]> {
  const args = [
    "pr",
    "list",
    "-R",
    repo,
    "--state",
    "merged",
    "--limit",
    "5000",
    "--json",
    FIELDS,
  ];
  if (since) args.push("--search", `merged:>=${since}`);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const { stdout } = await run("gh", args, { maxBuffer: 256 * 1024 * 1024 });
      return JSON.parse(stdout) as RawPr[];
    } catch (err) {
      lastErr = err;
      const msg = (err as { stderr?: string }).stderr ?? String(err);
      if (!/HTTP 5\d\d|timeout|rate limit/i.test(msg) || attempt === 5) break;
      const wait = 2000 * attempt;
      console.warn(`\n  ${repo}: ${msg.trim()} (retry ${attempt}/5 in ${wait / 1000}s)`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
