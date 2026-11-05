#!/usr/bin/env node
// GPT (OpenAI Codex CLI) code review, run from inside Claude Code via /gpt-review.
//
//   node scripts/gpt-review.mjs                      # uncommitted changes (default)
//   node scripts/gpt-review.mjs --base main          # branch vs. main
//   node scripts/gpt-review.mjs --commit <sha>       # one commit
//   node scripts/gpt-review.mjs -- "focus on i18n"   # extra instructions for the reviewer
//
// Prints the review to stdout. Exit codes: 0 review printed, 2 nothing to review,
// 3 codex not installed, 4 not logged in, 1 codex failed.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
let mode = "--uncommitted";
let target = null;
const extra = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--uncommitted") mode = a;
  else if (a === "--base" || a === "--commit") { mode = a; target = argv[++i]; }
  else if (a === "--") { extra.push(...argv.slice(i + 1)); break; }
  else extra.push(a);
}
if ((mode === "--base" || mode === "--commit") && !target) {
  console.error(`${mode} needs a value (e.g. ${mode} ${mode === "--base" ? "main" : "<sha>"})`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

// 1. codex installed?
const version = run("codex", ["--version"]);
if (version.error || version.status !== 0) {
  console.error("Codex CLI is not installed. Install it with:\n\n  npm install -g @openai/codex\n");
  process.exit(3);
}

// 2. logged in?
const login = run("codex", ["login", "status"]);
if (/not logged in/i.test(`${login.stdout}${login.stderr}`)) {
  console.error(
    "Codex is not logged in. Either:\n" +
      "  codex login                                   # ChatGPT Plus/Pro/Team account\n" +
      "  printenv OPENAI_API_KEY | codex login --with-api-key\n",
  );
  process.exit(4);
}

// 3. anything to review?
if (mode === "--uncommitted") {
  const status = run("git", ["status", "--porcelain"]);
  if (status.status === 0 && status.stdout.trim() === "") {
    console.log("Nothing to review: the working tree is clean. Try --base main or --commit <sha>.");
    process.exit(2);
  }
}

// 4. run the review
const prompt = [
  "You are the second reviewer. Another assistant (Claude) wrote this change and will fix what you find.",
  "Review for correctness bugs, security issues (this app handles children's data and family keys),",
  "broken i18n (all UI strings go through src/lib/i18n), and anything that breaks Next.js 16 / React 19 conventions.",
  "Be concrete: file, line, what is wrong, how to fix. Rank by severity. Say explicitly if you found nothing serious.",
  "Do not rewrite style or add features. Do not modify any files.",
  extra.length ? `Extra focus from the developer: ${extra.join(" ")}` : "",
]
  .filter(Boolean)
  .join("\n");

const dir = mkdtempSync(join(tmpdir(), "gpt-review-"));
const out = join(dir, "review.md");
const args = ["exec", "review", mode];
if (target) args.push(target);
args.push("--color", "never", "-o", out, prompt);

console.error(`$ codex ${args.slice(0, target ? 4 : 3).join(" ")} …`);
const res = spawnSync("codex", args, { stdio: ["ignore", "ignore", "inherit"] });

let review = "";
try { review = readFileSync(out, "utf8"); } catch { /* no output file */ }
rmSync(dir, { recursive: true, force: true });

if (res.status !== 0 && !review.trim()) {
  console.error(`codex exited with ${res.status ?? res.signal}`);
  process.exit(1);
}

console.log("\n===== GPT REVIEW (Codex) =====\n");
console.log(review.trim() || "(empty review)");
