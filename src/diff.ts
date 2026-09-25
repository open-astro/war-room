/**
 * Fetch a PR's code diff and trim it to what a summarizer needs: skip generated
 * and vendored files, cap lines per file and total size, keep file headers so
 * the model still sees which files were touched even when hunks are dropped.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const MAX_TOTAL_CHARS = 14_000;
const MAX_LINES_PER_FILE = 120;

const SKIP_FILE = [
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum|composer\.lock|Gemfile\.lock)$/,
  /\.(min\.js|min\.css|map|snap|lock|svg|png|jpg|jpeg|gif|ico|woff2?|ttf|pdf|bin|wasm)$/i,
  /(^|\/)(vendor|third_party|node_modules|dist|build|__snapshots__|fixtures?)\//,
  /\.generated\.|\.g\.(cs|dart)$|_pb2?\.(py|go|ts|js)$/,
];

export interface TrimmedDiff {
  text: string;
  files: number;
  skippedFiles: string[];
  truncated: boolean;
}

export async function fetchPrDiff(repo: string, number: number): Promise<TrimmedDiff> {
  let raw = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { stdout } = await run("gh", ["pr", "diff", String(number), "-R", repo], {
        maxBuffer: 64 * 1024 * 1024,
      });
      raw = stdout;
      break;
    } catch (err) {
      const msg = (err as { stderr?: string }).stderr ?? String(err);
      if (attempt === 4 || !/HTTP 5\d\d|timeout|rate limit|too large/i.test(msg)) {
        // A diff that GitHub refuses to render (too large) still gets an empty diff, not a hard failure.
        if (/too large|Sorry, this diff/i.test(msg)) return { text: "", files: 0, skippedFiles: [], truncated: true };
        throw err;
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return trimDiff(raw);
}

export function trimDiff(raw: string): TrimmedDiff {
  const sections = raw.split(/^(?=diff --git )/m).filter(Boolean);
  const out: string[] = [];
  const skippedFiles: string[] = [];
  let total = 0;
  let truncated = false;

  for (const section of sections) {
    const header = section.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const path = header?.[2] ?? "unknown";
    if (SKIP_FILE.some((re) => re.test(path))) {
      skippedFiles.push(path);
      continue;
    }
    const lines = section.split("\n");
    let body = lines;
    if (lines.length > MAX_LINES_PER_FILE) {
      body = [...lines.slice(0, MAX_LINES_PER_FILE), `... (${lines.length - MAX_LINES_PER_FILE} more lines in ${path})`];
      truncated = true;
    }
    const text = body.join("\n");
    if (total + text.length > MAX_TOTAL_CHARS) {
      out.push(`diff --git a/${path} b/${path}\n... (diff omitted for size)`);
      truncated = true;
      continue;
    }
    out.push(text);
    total += text.length;
  }

  return { text: out.join("\n"), files: sections.length, skippedFiles, truncated };
}
