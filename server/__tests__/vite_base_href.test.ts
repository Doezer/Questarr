import express from "express";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { relativeBaseHref, serveStatic, withBaseHref } from "../vite.js";

const builtIndex = `<!doctype html>
<html lang="en">
  <head>
    <script type="module" crossorigin src="./assets/index-abc.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`;

describe("relativeBaseHref", () => {
  it.each([
    ["/", "./"],
    ["/settings", "./"],
    ["/activity/imports", "../"],
    ["/activity/imports/", "../../"],
  ])("climbs from %s back to the app root with %s", (appPath, href) => {
    expect(relativeBaseHref(appPath)).toBe(href);
  });

  it("keeps an external prefix that a proxy stripped", () => {
    // The browser is on /Questarr/activity/imports; Questarr only sees /activity/imports.
    const base = new URL(
      relativeBaseHref("/activity/imports"),
      "http://host/Questarr/activity/imports"
    );
    expect(new URL("./assets/index-abc.js", base).pathname).toBe("/Questarr/assets/index-abc.js");
  });
});

describe("withBaseHref", () => {
  it("puts the <base> before the relative asset URLs", () => {
    const html = withBaseHref(builtIndex, "../");
    expect(html).toContain('<head>\n    <base href="../" />');
    expect(html.indexOf("<base")).toBeLessThan(html.indexOf("./assets/index-abc.js"));
  });
});

describe("serveStatic", () => {
  const distPath = mkdtempSync(path.join(tmpdir(), "questarr-dist-"));
  mkdirSync(path.join(distPath, "assets"));
  writeFileSync(path.join(distPath, "index.html"), builtIndex);
  writeFileSync(path.join(distPath, "assets", "index-abc.js"), "console.log('app');");

  const createApp = () => {
    const app = express();
    serveStatic(app, distPath);
    return app;
  };

  it.each([
    ["/", "./"],
    ["/activity/imports?tab=all", "../"],
  ])("serves index.html at %s with <base href=%s>", async (url, href) => {
    const response = await request(createApp()).get(url);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain(`<base href="${href}" />`);
  });

  const createMountedApp = () => {
    const root = express();
    const app = express();
    serveStatic(app, distPath, "/Questarr");
    root.use("/Questarr", app);
    return root;
  };

  it("measures the depth inside QUESTARR_BASE_PATH, not from the host root", async () => {
    const response = await request(createMountedApp()).get("/Questarr/activity/imports");
    expect(response.text).toContain('<base href="../" />');
  });

  it("strips QUESTARR_BASE_PATH whatever its case, as Express mounts it", async () => {
    const response = await request(createMountedApp()).get("/questarr/activity/imports");
    expect(response.text).toContain('<base href="../" />');
  });

  it.each([
    ["/Questarr", "/Questarr/"],
    ["/Questarr?tab=all", "/Questarr/?tab=all"],
  ])("redirects the bare mount root %s to %s", async (url, location) => {
    const response = await request(createMountedApp()).get(url);
    expect(response.status).toBe(301);
    expect(response.headers.location).toBe(location);
  });

  it("still serves built assets as files", async () => {
    const response = await request(createApp()).get("/assets/index-abc.js");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("javascript");
  });
});
