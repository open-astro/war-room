import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Category } from "./types.js";

const MODEL = "claude-opus-5";
const MAX_BODY_CHARS = 8000;

const SummarySchema = z.object({
  summary: z
    .string()
    .describe(
      "One to three plain-English sentences a non-programmer can understand: what changed and why it matters to the project.",
    ),
  category: z.enum([
    "feature",
    "fix",
    "refactor",
    "tests",
    "docs",
    "ci",
    "chore",
  ]),
});

const SYSTEM = `You write short summaries of merged pull requests for a "war room" dashboard read by the whole team, including non-developers.

Rules:
- Explain what the change does for the project in everyday language. Avoid jargon, file names, class names, and function names unless there is no plain way to say it.
- Say why it matters when the PR body makes that clear. Do not speculate.
- One to three sentences. No bullet points, no headings, no preamble.
- If the PR is purely internal (tests, CI, cleanup), say so plainly.`;

let client: Anthropic | null = null;

export function summarizerAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export interface SummaryInput {
  repo: string;
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export async function summarizePr(
  pr: SummaryInput,
): Promise<{ summary: string; category: Category }> {
  client ??= new Anthropic();
  const body =
    pr.body.length > MAX_BODY_CHARS
      ? pr.body.slice(0, MAX_BODY_CHARS) + "\n[truncated]"
      : pr.body;
  const labels = pr.labels.length ? `Labels: ${pr.labels.join(", ")}\n` : "";

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "low", format: zodOutputFormat(SummarySchema) },
    messages: [
      {
        role: "user",
        content: `Repository: ${pr.repo}\nPR #${pr.number}: ${pr.title}\n${labels}\n${body || "(no description)"}`,
      },
    ],
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error(
      `No summary for ${pr.repo}#${pr.number} (stop_reason=${response.stop_reason})`,
    );
  }
  return response.parsed_output;
}
