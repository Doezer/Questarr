import { execFileSync } from "node:child_process";
import console from "node:console";
import process from "node:process";

// Usage: node scripts/weekly-release-notes.mjs <previous-tag> <new-tag> [repo]
// Builds the notes of a weekly pre-release from the pull requests merged on main
// since <previous-tag>, plus commits pushed straight to main.
const [prevTag, newTag, repo = process.env.GITHUB_REPOSITORY] = process.argv.slice(2);
if (!prevTag || !newTag) {
  console.error("Usage: node scripts/weekly-release-notes.mjs <previous-tag> <new-tag> [repo]");
  process.exit(1);
}

const run = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const SECURITY = /\b(CVE-\d{4}-\d+|GHSA-[\w-]+|vulnerab\w*|security|codeql|overrides?)\b/i;

// First-parent history of main: merge commits stand for PRs, the others were pushed directly.
const log = run("git", ["log", "--first-parent", "--format=%H%x1f%s%x1f%an", `${prevTag}..HEAD`]);
const commits = log
  ? log.split("\n").map((line) => {
      const [sha, subject, author] = line.split("\x1f");
      return { sha, subject, author };
    })
  : [];

const prs = new Map();
const direct = [];
for (const { sha, subject, author } of commits) {
  const number =
    subject.match(/^Merge pull request #(\d+)/)?.[1] ?? subject.match(/\(#(\d+)\)\s*$/)?.[1];
  if (number) prs.set(Number(number), { number: Number(number), sha });
  else if (!/^Merge (branch|remote-tracking)/.test(subject)) direct.push({ sha, subject, author });
}

for (const pr of prs.values()) {
  try {
    const info = JSON.parse(
      run("gh", [
        "pr",
        "view",
        String(pr.number),
        ...(repo ? ["--repo", repo] : []),
        "--json",
        "title,author,labels",
      ])
    );
    pr.title = info.title;
    pr.author = info.author?.login;
    pr.labels = info.labels.map((l) => l.name);
  } catch {
    // gh unavailable: fall back to the merge commit message.
    const body = run("git", ["show", "-s", "--format=%b", pr.sha]).split("\n")[0];
    pr.title = body || `Pull request #${pr.number}`;
    pr.labels = [];
  }
}

const isSecurity = (title, labels = []) =>
  labels.some((l) => /security|vulnerab|dependenc/i.test(l)) || SECURITY.test(title);

const fmtPr = (pr) => `- ${pr.title} (#${pr.number})${pr.author ? ` by @${pr.author}` : ""}`.trim();

const sorted = [...prs.values()].sort((a, b) => a.number - b.number);
const security = sorted.filter((pr) => isSecurity(pr.title, pr.labels));
const others = sorted.filter((pr) => !security.includes(pr));

const out = [
  "> **Weekly development build** — automatically generated from `main`, not functionally tested.",
  "> Use a stable release for production. The Docker image is tagged with this version and `dev`; `latest` is untouched.",
  "",
];
if (security.length) out.push("## Security and dependency fixes", "", ...security.map(fmtPr), "");
if (others.length) out.push("## Pull requests", "", ...others.map(fmtPr), "");
if (direct.length) {
  out.push(
    "## Commits pushed directly to main",
    "",
    ...direct.map((c) => `- ${c.subject} (${c.sha.slice(0, 7)})`),
    ""
  );
}
if (!sorted.length && !direct.length) out.push("No changes since the previous build.", "");
if (repo)
  out.push(`**Full Changelog**: https://github.com/${repo}/compare/${prevTag}...${newTag}`, "");
console.log(out.join("\n"));
