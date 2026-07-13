import console from "node:console";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/extract-changelog.mjs <version>");
  process.exit(1);
}

const changelogPath = path.join(repoRoot, "docs", "CHANGELOG.md");
const lines = fs.readFileSync(changelogPath, "utf8").split("\n");

const headingPattern = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`);
const startIndex = lines.findIndex((line) => headingPattern.test(line));

if (startIndex === -1) {
  console.error(`No CHANGELOG.md entry found for version ${version}`);
  process.exit(1);
}

let endIndex = lines.findIndex((line, i) => i > startIndex && /^## \[/.test(line));
if (endIndex === -1) endIndex = lines.length;

const section = lines
  .slice(startIndex + 1, endIndex)
  .join("\n")
  .replace(/^\n+/, "")
  .replace(/\n+$/, "");

console.log(section);
