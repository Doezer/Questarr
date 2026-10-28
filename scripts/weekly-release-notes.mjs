import { execFileSync } from "node:child_process";
import console from "node:console";
import process from "node:process";

// Usage: node scripts/weekly-release-notes.mjs <previous-tag> <new-tag> [repo] [end-ref]
// Builds the notes of a weekly pre-release from the pull requests merged on main
// since <previous-tag>, plus commits pushed straight to main. Contributors are counted by commit.
const [prevTag, newTag, repo = process.env.GITHUB_REPOSITORY, endRef = "HEAD"] =
  process.argv.slice(2);
if (!prevTag || !newTag) {
  console.error(
    "Usage: node scripts/weekly-release-notes.mjs <previous-tag> <new-tag> [repo] [end-ref]"
  );
  process.exit(1);
}

const run = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const SECURITY = /\b(CVE-\d{4}-\d+|GHSA-[\w-]+|vulnerab\w*|security|codeql|overrides?)\b/i;

// First-parent history of main: merge commits stand for PRs, the others were pushed directly.
const log = run("git", [
  "log",
  "--first-parent",
  "--format=%H%x1f%s%x1f%an",
  `${prevTag}..${endRef}`,
]);
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
  if (number) prs.set(Number(number), { number: Number(number), sha, subject });
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
    // gh reports bot authors as "app/<name>" with is_bot, not with a "[bot]" suffix.
    pr.isBot = Boolean(info.author?.is_bot) || /^app\//.test(pr.author ?? "");
    pr.labels = info.labels.map((l) => l.name);
  } catch {
    // gh unavailable: fall back to the merge commit message.
    // Merge commits keep the PR title in the body; squash merges in the subject.
    const isMerge = /^Merge pull request #/.test(pr.subject);
    const body = isMerge ? run("git", ["show", "-s", "--format=%b", pr.sha]).split("\n")[0] : "";
    pr.title = body || pr.subject.replace(/\s*\(#\d+\)\s*$/, "") || `Pull request #${pr.number}`;
    pr.labels = [];
  }
}

const isSecurity = (title, labels = []) =>
  labels.some((l) => /security|vulnerab|dependenc/i.test(l)) || SECURITY.test(title);

const fmtPr = (pr) => `- ${pr.title} (#${pr.number})${pr.author ? ` by @${pr.author}` : ""}`.trim();

const sorted = [...prs.values()].sort((a, b) => a.number - b.number);
const security = sorted.filter((pr) => isSecurity(pr.title, pr.labels));
const others = sorted.filter((pr) => !security.includes(pr));

// Contributors, counted by commit: the commits inside each merged PR plus the ones pushed straight
// to main. Bots and the Claude agent (it commits for the person who asked) are left out, and one
// person with several git names is one contributor because the email is the key.
const NOREPLY = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i;
const BOT_NAME = /\[bot\]|[-\s]bot$/i; // dependabot[bot], snyk-bot
const isBotAuthor = (name, email) =>
  BOT_NAME.test(name) || BOT_NAME.test(email.split("@")[0]) || /@anthropic\.com$/i.test(email);

const commitsOf = (pr) => {
  const isMerge = run("git", ["rev-list", "--parents", "-n", "1", pr.sha]).split(" ").length > 2;
  // A merge commit keeps the PR's commits on its second parent; a squash merge is one commit.
  const range = isMerge ? [`${pr.sha}^1..${pr.sha}^2`] : ["-1", pr.sha];
  const log = run("git", ["log", "--no-merges", "--format=%H%x1f%an%x1f%ae", ...range]);
  return log ? log.split("\n").map((line) => line.split("\x1f")) : [];
};

const people = new Map();
const credit = (sha, name, email, prNumber) => {
  if (isBotAuthor(name, email)) return;
  const key = email.toLowerCase();
  const person = people.get(key) ?? { sha, name, email, commits: 0, prs: new Set() };
  person.commits += 1;
  if (prNumber) person.prs.add(prNumber);
  people.set(key, person);
};
for (const pr of sorted) {
  for (const [sha, name, email] of commitsOf(pr)) credit(sha, name, email, pr.number);
}
for (const c of direct) {
  const email = run("git", ["show", "-s", "--format=%ae", c.sha]);
  credit(c.sha, c.author, email);
}

// A GitHub login is shown when the noreply address or gh can give one, else the git name.
const loginOf = (person) => {
  const fromEmail = person.email.match(NOREPLY)?.[1];
  if (fromEmail) return fromEmail;
  try {
    return (
      run("gh", ["api", `repos/${repo}/commits/${person.sha}`, "--jq", ".author.login // empty"]) ||
      undefined
    );
  } catch {
    return undefined;
  }
};
const contributors = [...people.values()]
  .map((person) => ({ ...person, login: loginOf(person) }))
  .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name))
  .map((person) => {
    const who = person.login ? `@${person.login}` : person.name;
    const prs = [...person.prs].sort((x, y) => x - y).map((n) => `#${n}`);
    const count = `${person.commits} commit${person.commits === 1 ? "" : "s"}`;
    return `- ${who}, ${count}${prs.length ? ` (${prs.join(", ")})` : " (pushed directly to main)"}`;
  });

const out = [
  "> **Weekly development build** — automatically generated from `main`, not functionally tested.",
  "> Use a stable release for production. The Docker image is tagged with this version and `weekly` (always the latest weekly build); `latest` is untouched.",
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
if (contributors.length) {
  out.push(
    "## Contributors",
    "",
    "Thanks to everyone whose commits are in this build, counted by commit:",
    "",
    ...contributors,
    ""
  );
}
if (!sorted.length && !direct.length) out.push("No changes since the previous build.", "");
if (repo)
  out.push(`**Full Changelog**: https://github.com/${repo}/compare/${prevTag}...${newTag}`, "");
console.log(out.join("\n"));
