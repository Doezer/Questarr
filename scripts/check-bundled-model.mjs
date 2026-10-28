// Proves the production build finds the bundled classifier model the way a deployed install does:
// dist/, shared/ and node_modules in one folder, started from that folder. It also checks that
// the lookup really depends on shared/models, so a packaging change that drops the file fails.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const app = fs.mkdtempSync(path.join(os.tmpdir(), "questarr-model-check-"));
fs.mkdirSync(path.join(app, "data"));
fs.cpSync(path.join(root, "dist"), path.join(app, "dist"), { recursive: true });
fs.cpSync(path.join(root, "shared", "models"), path.join(app, "shared", "models"), {
  recursive: true,
});
fs.copyFileSync(path.join(root, "package.json"), path.join(app, "package.json"));
fs.symlinkSync(path.join(root, "node_modules"), path.join(app, "node_modules"), "dir");

const probe = `
const { localGuess } = await import("./dist/server/classification/index.js");
const guess = localGuess({ title: "Some.Game-FitGirl.Repack", gameTitle: "Some Game" });
console.log("RESULT " + JSON.stringify(guess));
process.exit(0);
`;

function run() {
  const out = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
    cwd: app,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      JWT_SECRET: "model-check",
      SQLITE_DB_PATH: path.join(app, "data", "sqlite.db"),
      CLASSIFIER_MODEL_PATH: "",
    },
  });
  const line = `${out.stdout}`.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) throw new Error(`The probe printed no result:\n${out.stdout}\n${out.stderr}`);
  return JSON.parse(line.slice("RESULT ".length));
}

let failed = false;
try {
  const withModel = run();
  if (!withModel?.modelVersion?.startsWith("tfidf-")) {
    console.error("FAIL: the built server did not load the bundled model:", withModel);
    failed = true;
  } else {
    console.log(`OK: bundled model ${withModel.modelVersion} loaded from the built server`);
  }
  fs.rmSync(path.join(app, "shared"), { recursive: true });
  const without = run();
  if (without !== null) {
    console.error(
      "FAIL: a model was found without shared/models, so the lookup is not what we test"
    );
    failed = true;
  }
} finally {
  fs.rmSync(app, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
