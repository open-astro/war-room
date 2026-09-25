/**
 * Summarizer backend that runs headless Claude Code (`claude -p`) instead of
 * the Anthropic SDK. Uses the Claude subscription via CLAUDE_CODE_OAUTH_TOKEN
 * (from `claude setup-token`), the same auth the other open-astro repos use
 * for claude-code-action. PRs are sent in batches to keep call count low.
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Category } from "./types.js";
import { SYSTEM_RULES, describePr, type SummaryInput } from "./summarize.js";

const run = promisify(execFile);

const SYSTEM = `${SYSTEM_RULES}

Output: respond with ONLY a JSON array, no prose and no code fence. One object per input PR, in the same order, shaped {"id": string, "summary": string, "category": one of "feature","fix","refactor","tests","docs","ci","chore"}.`;

const ResultSchema = z.array(
  z.object({
    id: z.string(),
    summary: z.string().min(1),
    category: z.enum(["feature", "fix", "refactor", "tests", "docs", "ci", "chore"]),
  }),
);

export async function cliAvailable(): Promise<boolean> {
  try {
    await run("claude", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/** Summarize a batch of PRs in one `claude -p` call. Returns results keyed by "repo#number". */
export async function summarizeBatchCli(
  prs: SummaryInput[],
  model = "opus",
): Promise<Map<string, { summary: string; category: Category }>> {
  const prompt =
    `Summarize these ${prs.length} merged pull requests. Use the id shown for each.\n\n` +
    prs.map((p) => `===== id: ${p.repo}#${p.number} =====\n${describePr(p)}`).join("\n\n");

  // The prompt goes through stdin: with diffs attached it can exceed the OS
  // argument-length limit (spawn E2BIG) if passed as an argv string.
  const stdout = await runClaude(
    [
      "-p",
      "--no-session-persistence",
      "--tools",
      "",
      "--max-turns",
      "1",
      "--model",
      model,
      "--output-format",
      "json",
      "--system-prompt",
      SYSTEM,
    ],
    prompt,
  );

  const envelope = JSON.parse(stdout) as { is_error?: boolean; result?: string };
  if (envelope.is_error || typeof envelope.result !== "string") {
    throw new Error(`claude -p failed: ${JSON.stringify(envelope).slice(0, 300)}`);
  }
  const text = envelope.result.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = ResultSchema.parse(JSON.parse(text));
  return new Map(parsed.map((r) => [r.id, { summary: r.summary, category: r.category }]));
}

function runClaude(args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => (out += c));
    child.stderr.setEncoding("utf8").on("data", (c: string) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`claude exited ${code}: ${err.trim().slice(0, 300)}`));
    });
    child.stdin.on("error", () => { /* claude exited before reading everything; the close handler reports it */ });
    child.stdin.end(input);
  });
}
