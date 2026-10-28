// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../weekly-release-notes.mjs");

let repoDir: string;
let binDir: string;

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repoDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const commit = (name: string, email: string, message: string) => {
  git(
    "-c",
    `user.name=${name}`,
    "-c",
    `user.email=${email}`,
    "commit",
    "--allow-empty",
    "-m",
    message
  );
};

beforeAll(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "weekly-notes-"));
  // Only git and node on PATH, so the script falls back to git data instead of calling gh.
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), "weekly-notes-bin-"));
  const gitPath = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  fs.symlinkSync(gitPath, path.join(binDir, "git"));

  git("init", "-q", "-b", "main");
  commit("Owner", "1+owner@users.noreply.github.com", "Initial commit");
  git("tag", "v0");

  // A merged PR with commits from one person under two git names, plus agent and bot commits.
  git("checkout", "-q", "-b", "feature");
  commit("Alice", "2+alice@users.noreply.github.com", "Add feature");
  commit("Alice Work", "2+alice@users.noreply.github.com", "Polish feature");
  commit("Claude", "noreply@anthropic.com", "Agent commit");
  commit("snyk-bot", "bot@snyk.io", "Bot commit");
  commit("Copilot", "198982749+Copilot@users.noreply.github.com", "Copilot commit");
  git("checkout", "-q", "main");
  git(
    "-c",
    "user.name=Owner",
    "-c",
    "user.email=1+owner@users.noreply.github.com",
    "merge",
    "--no-ff",
    "feature",
    "-m",
    "Merge pull request #7 from fork/feature",
    "-m",
    "Add feature"
  );

  // A squash-merged PR with a co-author, a second email for Alice, and a commit pushed to main.
  commit(
    "Bob",
    "3+bob@users.noreply.github.com",
    "Fix a thing (#9)\n\nCo-authored-by: Carol <4+carol@users.noreply.github.com>"
  );
  commit("Alice", "alice@users.noreply.github.com", "Another fix");
  commit("Owner", "1+owner@users.noreply.github.com", "Tweak the README");
});

afterAll(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
  fs.rmSync(binDir, { recursive: true, force: true });
});

describe("weekly-release-notes contributors", () => {
  const notes = () =>
    execFileSync(process.execPath, [SCRIPT, "v0", "v1"], {
      cwd: repoDir,
      encoding: "utf8",
      env: { ...process.env, PATH: binDir, GITHUB_REPOSITORY: "" },
    });

  it("counts commits inside a merged pull request, one person under several names", () => {
    expect(notes()).toContain("- @alice, 3 commits (#7)");
  });

  it("counts a squash-merged pull request and a direct commit", () => {
    const out = notes();
    expect(out).toContain("- @bob, 1 commit (#9)");
    expect(out).toContain("- @carol, 1 commit (#9)");
    expect(out).toContain("- @owner, 1 commit (pushed directly to main)");
  });

  it("merges two emails that resolve to the same login", () => {
    // 2 commits under the numbered noreply address plus 1 under the old login-only form
    expect(notes().match(/@alice/g)).toHaveLength(1);
  });

  it("leaves out the Claude agent and bots", () => {
    const section = notes().split("## Contributors")[1] ?? "";
    expect(section).not.toMatch(/claude|snyk|copilot/i);
  });
});
