import { describe, it, expect } from "vitest";
import { isAdminApiRoute } from "../admin-api-routes.js";

describe("isAdminApiRoute", () => {
  it.each([
    ["GET", "/downloaders"],
    ["POST", "/downloaders"],
    ["PATCH", "/downloaders/abc"],
    ["DELETE", "/downloaders/abc"],
    ["POST", "/downloaders/abc/test"],
    ["GET", "/indexers"],
    ["GET", "/indexers/prowlarr/settings"],
    ["POST", "/indexers/prowlarr/sync"],
    ["POST", "/indexers/abc/test"],
    ["GET", "/settings"],
    ["PATCH", "/settings"],
    ["GET", "/settings/apprise"],
    ["POST", "/settings/apprise"],
    ["POST", "/settings/apprise/test"],
    ["GET", "/imports/config"],
    ["PATCH", "/imports/config"],
    ["GET", "/imports/mappings/paths"],
    ["POST", "/imports/mappings/paths"],
    ["PATCH", "/imports/mappings/paths/abc"],
    ["DELETE", "/imports/mappings/paths/abc"],
    ["GET", "/imports/hardlink/check"],
    ["get", "/downloaders/"],
  ])("allows %s %s", (method, path) => {
    expect(isAdminApiRoute(method, path)).toBe(true);
  });

  it.each([
    ["POST", "/indexers"],
    ["DELETE", "/indexers/abc"],
    ["PATCH", "/settings/ssl"],
    ["GET", "/settings/ssl"],
    ["POST", "/settings/igdb"],
    ["GET", "/api-keys"],
    ["POST", "/api-keys"],
    ["DELETE", "/api-keys/abc"],
    ["PUT", "/downloaders/abc"],
    ["GET", "/downloaders/abc/downloads"],
    ["DELETE", "/downloaders/abc/test"],
    ["GET", "/imports/history"],
    ["GET", "/auth/me"],
  ])("refuses %s %s", (method, path) => {
    expect(isAdminApiRoute(method, path)).toBe(false);
  });
});
