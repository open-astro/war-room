# OpenAstro War Room

A single-page dashboard of every merged pull request across the OpenAstro repos, each with a short plain-English summary of what it did. GitHub is the source of truth; there is no database. A collector script pulls merged PRs into `site/data/prs.json`, and the static page in `site/` reads that file.

## How it works

```
repos.json  ──►  src/collect.ts  ──►  site/data/prs.json  ──►  site/index.html
                 (gh CLI + Claude)                              (GitHub Pages)
```

- **`repos.json`** lists the repos to track. Add a line, commit, and the next run picks it up.
- **`src/collect.ts`** fetches merged PRs with the `gh` CLI (incrementally once everything is summarized), then asks Claude for a plain-English summary and a category for every PR that does not have one yet. Each summary is based on the PR description **and** a trimmed copy of the code diff (`src/diff.ts` drops lockfiles, vendored and generated files, and caps size), so it reflects what actually changed. Summaries are cached in the JSON and only regenerated if a PR's title or body changes, or when `SUMMARY_VERSION` in the collector is bumped.
- **`site/index.html`** is a dependency-free page: filters by repo, developer, type, date range and search; a weekly stacked bar chart; a developer leaderboard; and a card or table list of PRs.
- **`.github/workflows/collect.yml`** runs the collector hourly, commits the refreshed JSON, and deploys `site/` to GitHub Pages.

## Local setup

Requires Node 22+ and a logged-in `gh` CLI (`gh auth login`).

```bash
npm install
npm run collect:fetch   # pull PRs only, no summaries
npm run collect         # pull PRs and generate summaries (uses your claude login or ANTHROPIC_API_KEY)
npm run serve           # preview at http://localhost:8787
```

### Summaries: two ways to authenticate

1. **Claude subscription (default, same as the other open-astro repos).** The collector runs headless Claude Code (`claude -p`) in batches of 12 PRs. Locally this uses your existing `claude` login. In Actions it uses the `CLAUDE_CODE_OAUTH_TOKEN` secret, created with:

   ```bash
   claude setup-token
   gh secret set CLAUDE_CODE_OAUTH_TOKEN -R open-astro/war-room
   ```

2. **Anthropic API key.** If `ANTHROPIC_API_KEY` is set (shell, `.env`, or the repo secret), the collector uses the Anthropic SDK with `claude-opus-5` at low effort instead. A first full run over ~1,400 PRs costs on the order of $10-20.

Either way, summaries are cached and only new or edited PRs are summarized on later runs.

Useful flags:

```bash
npm run collect -- --full           # ignore the incremental cutoff and re-fetch everything
npm run collect -- --no-summaries   # same as collect:fetch
npm run collect -- --limit 20       # summarize at most 20 PRs (for testing)
```

## Deploying with GitHub Actions

1. Push this repo to GitHub.
2. In **Settings → Pages**, set the source to **GitHub Actions**.
3. Add the `CLAUDE_CODE_OAUTH_TOKEN` secret (see above), or `ANTHROPIC_API_KEY` if you prefer API billing.
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
