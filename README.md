# OpenAstro War Room

A single-page dashboard of every merged pull request across the OpenAstro repos, each with a short plain-English summary of what it did. GitHub is the source of truth; there is no database. A collector script pulls merged PRs into `site/data/prs.json`, and the static page in `site/` reads that file.

## How it works

```
repos.json  ──►  src/collect.ts  ──►  site/data/prs.json  ──►  site/index.html
                 (gh CLI + Claude)                              (GitHub Pages)
```

- **`repos.json`** lists the repos to track. Add a line, commit, and the next run picks it up.
- **`src/collect.ts`** fetches merged PRs with the `gh` CLI (incrementally after the first run), then asks Claude for a one-to-three sentence layman's summary and a category for every PR that does not have one yet. Summaries are cached in the JSON and only regenerated if a PR's title or body changes.
- **`site/index.html`** is a dependency-free page: filters by repo, developer, type, date range and search; a weekly stacked bar chart; a developer leaderboard; and a card or table list of PRs.
- **`.github/workflows/collect.yml`** runs the collector hourly, commits the refreshed JSON, and deploys `site/` to GitHub Pages.

## Local setup

Requires Node 22+ and a logged-in `gh` CLI (`gh auth login`).

```bash
npm install
npm run collect:fetch   # pull PRs only, no summaries
npm run collect         # pull PRs and generate summaries (needs ANTHROPIC_API_KEY)
npm run serve           # preview at http://localhost:8787
```

Set `ANTHROPIC_API_KEY` in your shell before `npm run collect`. Summaries use `claude-opus-5` at low effort; the first full run over ~1,400 PRs costs on the order of $10-20, and after that only new PRs are summarized.

Useful flags:

```bash
npm run collect -- --full           # ignore the incremental cutoff and re-fetch everything
npm run collect -- --no-summaries   # same as collect:fetch
```

## Deploying with GitHub Actions

1. Push this repo to GitHub.
2. In **Settings → Pages**, set the source to **GitHub Actions**.
3. In **Settings → Secrets and variables → Actions**, add `ANTHROPIC_API_KEY`.
4. If any tracked repo is private or in a different org, also add `GH_PAT` (a fine-grained token with read access to pull requests). Public repos work with the default token.
5. Run the **Collect PRs and deploy dashboard** workflow once from the Actions tab. After that it runs every hour.

## Data shape

Each entry in `site/data/prs.json` looks like:

```json
{
  "repo": "open-astro/AlpacaBridge",
  "number": 654,
  "title": "test: cross-driver contract sweep, tier 1",
  "url": "https://github.com/open-astro/AlpacaBridge/pull/654",
  "author": "diegopereiran",
  "mergedAt": "2026-09-25T15:17:42Z",
  "additions": 1200,
  "deletions": 40,
  "changedFiles": 12,
  "labels": [],
  "summary": "Adds a shared test harness that checks every device driver against the same rules...",
  "category": "tests",
  "summaryHash": "…"
}
```
