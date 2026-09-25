/**
 * Collector: pulls merged PRs from every repo in repos.json, merges them into
 * site/data/prs.json, and fills in plain-English summaries for any PR that
 * lacks one (or whose title/body changed since it was summarized).
 *
 *   npm run collect                # fetch + summarize (needs ANTHROPIC_API_KEY)
 *   npm run collect:fetch          # fetch only
 *   npm run collect -- --full      # ignore the incremental cutoff, re-fetch everything
 */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fetchMergedPrs, type RawPr } from "./github.js";
import { summarizePr, summarizerAvailable } from "./summarize.js";
import type { Dataset, PullRequest } from "./types.js";

// Load ANTHROPIC_API_KEY (and anything else) from a gitignored .env file if present.
try { process.loadEnvFile(".env"); } catch { /* no .env, rely on the shell environment */ }

const DATA_PATH = "site/data/prs.json";
const REPOS_PATH = "repos.json";
const CONCURRENCY = 4;

const args = new Set(process.argv.slice(2));
const wantSummaries = !args.has("--no-summaries");
const fullRefetch = args.has("--full");

function hashOf(pr: Pick<RawPr, "title" | "body">): string {
  return createHash("sha1").update(pr.title).update("\n").update(pr.body ?? "").digest("hex");
}

async function loadDataset(): Promise<Dataset> {
  try {
    const ds = JSON.parse(await readFile(DATA_PATH, "utf8")) as Dataset;
    lastSavedBody = JSON.stringify({ repos: ds.repos, prs: ds.prs });
    return ds;
  } catch {
    return { generatedAt: "", repos: [], prs: [] };
  }
}

/** Write only when repos or PR data actually changed, so scheduled runs don't produce no-op commits. */
async function saveDataset(ds: Dataset): Promise<boolean> {
  ds.prs.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
  const body = JSON.stringify({ repos: ds.repos, prs: ds.prs });
  if (body === lastSavedBody) return false;
  lastSavedBody = body;
  ds.generatedAt = new Date().toISOString();
  await mkdir("site/data", { recursive: true });
  await writeFile(DATA_PATH, JSON.stringify(ds, null, 2) + "\n");
  return true;
}
let lastSavedBody = "";

/** Re-fetch from a few days before the newest PR we already have, so late edits are caught. */
function sinceFor(ds: Dataset, repo: string): string | undefined {
  if (fullRefetch) return undefined;
  const newest = ds.prs.filter((p) => p.repo === repo).map((p) => p.mergedAt).sort().at(-1);
  if (!newest) return undefined;
  const d = new Date(newest);
  d.setUTCDate(d.getUTCDate() - 3);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const { repos } = JSON.parse(await readFile(REPOS_PATH, "utf8")) as { repos: string[] };
  const ds = await loadDataset();
  ds.repos = repos;
  const byKey = new Map(ds.prs.map((p) => [`${p.repo}#${p.number}`, p]));
  const bodies = new Map<string, string>();

  // 1. Fetch
  for (const repo of repos) {
    const since = sinceFor(ds, repo);
    process.stdout.write(`Fetching ${repo}${since ? ` (merged since ${since})` : ""}... `);
    const raw = await fetchMergedPrs(repo, since);
    let added = 0;
    for (const r of raw) {
      const key = `${repo}#${r.number}`;
      const existing = byKey.get(key);
      const h = hashOf(r);
      const next: PullRequest = {
        repo,
        number: r.number,
        title: r.title,
        url: r.url,
        author: r.author?.login ?? "unknown",
        mergedAt: r.mergedAt,
        additions: r.additions,
        deletions: r.deletions,
        changedFiles: r.changedFiles,
        labels: r.labels.map((l) => l.name),
        summary: existing?.summaryHash === h ? existing.summary : null,
        category: existing?.summaryHash === h ? existing.category : null,
        summaryHash: existing?.summaryHash === h ? existing.summaryHash : null,
      };
      if (!existing) added++;
      byKey.set(key, next);
      bodies.set(key, r.body ?? "");
    }
    console.log(`${raw.length} fetched, ${added} new`);
  }
  ds.prs = [...byKey.values()];
  await saveDataset(ds);

  // 2. Summarize
  const pending = ds.prs.filter((p) => !p.summary && bodies.has(`${p.repo}#${p.number}`));
  if (!wantSummaries) {
    console.log(`Skipping summaries (--no-summaries). ${pending.length} PRs still need one.`);
    return;
  }
  if (!summarizerAvailable()) {
    console.log(`ANTHROPIC_API_KEY not set. ${pending.length} PRs still need a summary.`);
    return;
  }
  console.log(`Summarizing ${pending.length} PRs with ${CONCURRENCY} workers...`);
  let done = 0;
  let failed = 0;
  const queue = [...pending];
  const worker = async () => {
    for (let pr = queue.shift(); pr; pr = queue.shift()) {
      const key = `${pr.repo}#${pr.number}`;
      try {
        const out = await summarizePr({ ...pr, body: bodies.get(key) ?? "" });
        pr.summary = out.summary;
        pr.category = out.category;
        pr.summaryHash = hashOf({ title: pr.title, body: bodies.get(key) ?? "" });
      } catch (err) {
        failed++;
        console.error(`  ${key}: ${(err as Error).message}`);
      }
      done++;
      if (done % 25 === 0) {
        await saveDataset(ds);
        console.log(`  ${done}/${pending.length}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const wrote = await saveDataset(ds);
  console.log(`Done. ${done - failed} summarized, ${failed} failed.${wrote ? "" : " No changes to write."}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
