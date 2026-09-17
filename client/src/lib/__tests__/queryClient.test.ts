/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ApiError,
  apiFetch,
  apiRequest,
  clearSearchCache,
  getQueryFn,
  queryClient,
  setBearerToken,
} from "../queryClient";

describe("queryClient utilities", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "questarr_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    setBearerToken(null);
    queryClient.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setBearerToken(null);
    document.cookie = "questarr_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    queryClient.clear();
  });

  it("creates ApiError instances with status and payload", () => {
    const err = new ApiError(400, "bad request", { reason: "invalid" });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ApiError");
    expect(err.status).toBe(400);
    expect(err.message).toBe("bad request");
    expect(err.data).toEqual({ reason: "invalid" });
  });

  it("apiRequest sends JSON body and authorization when an in-memory bearer token is set", async () => {
    setBearerToken("jwt-token");

    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    const res = await apiRequest("POST", "/api/test", { hello: "world" });

    expect(res).toBe(response);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/test");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(init?.body).toBe(JSON.stringify({ hello: "world" }));
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer jwt-token");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("apiRequest does not attach an Authorization header when no bearer token is set (cookie auth only)", async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await apiRequest("GET", "/api/test");

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.credentials).toBe("include");
    const headers = new Headers(init?.headers);
    expect(headers.has("Authorization")).toBe(false);
  });

  it("apiFetch clones Headers inputs before adding authorization", async () => {
    setBearerToken("jwt-token");

    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    const headers = new Headers({ Accept: "application/json" });

    await apiFetch("/api/test", { headers });

    expect(headers.has("Authorization")).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(requestInit?.headers).toBeInstanceOf(Headers);
    expect(requestInit?.headers).not.toBe(headers);
    expect((requestInit?.headers as Headers).get("Authorization")).toBe("Bearer jwt-token");
  });

  it("attaches X-CSRF-Token from the readable CSRF cookie on non-GET requests", async () => {
    document.cookie = "questarr_csrf=csrf-abc123; path=/";

    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await apiRequest("POST", "/api/test", { hello: "world" });

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("X-CSRF-Token")).toBe("csrf-abc123");
  });

  it("does not attach X-CSRF-Token on GET requests even when the cookie is present", async () => {
    document.cookie = "questarr_csrf=csrf-abc123; path=/";

    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await apiFetch("/api/test");

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.has("X-CSRF-Token")).toBe(false);
  });

  it("does not attach X-CSRF-Token on non-GET requests when there is no CSRF cookie (e.g. bearer-only session)", async () => {
    setBearerToken("jwt-token");

    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await apiRequest("POST", "/api/test", { hello: "world" });

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.has("X-CSRF-Token")).toBe(false);
  });

  it("apiRequest surfaces API message from JSON error payload", async () => {
    const response = new Response(JSON.stringify({ error: "nope" }), {
      status: 400,
      statusText: "Bad Request",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await expect(apiRequest("GET", "/api/fail")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "nope",
      data: { error: "nope" },
    });
  });

  it("apiRequest falls back to plain text payload when error body is not JSON", async () => {
    const response = new Response("service unavailable", {
      status: 503,
      statusText: "Service Unavailable",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await expect(apiRequest("GET", "/api/down")).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      message: "Service Unavailable",
      data: "service unavailable",
    });
  });

  it("apiRequest uses JSON message field when error is provided that way", async () => {
    const response = new Response(JSON.stringify({ message: "failed" }), {
      status: 422,
      statusText: "Unprocessable Entity",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await expect(apiRequest("GET", "/api/invalid")).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      message: "failed",
      data: { message: "failed" },
    });
  });

  it("apiRequest falls back to numeric status when no message source is available", async () => {
    const response = {
      ok: false,
      status: 418,
      statusText: "",
      text: vi.fn().mockResolvedValue("{}"),
    } as unknown as Response;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await expect(apiRequest("GET", "/api/teapot")).rejects.toMatchObject({
      name: "ApiError",
      status: 418,
      message: "418",
      data: {},
    });
  });

  it("getQueryFn returns null on 401 when configured to returnNull", async () => {
    const response = new Response("unauthorized", {
      status: 401,
      statusText: "Unauthorized",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    const queryFn = getQueryFn<unknown>({ on401: "returnNull" });
    const result = await queryFn({ queryKey: ["/api/me"] } as never);

    expect(result).toBeNull();
  });

  it("getQueryFn throws on 401 when configured to throw", async () => {
    const response = new Response("unauthorized", {
      status: 401,
      statusText: "Unauthorized",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    const queryFn = getQueryFn<unknown>({ on401: "throw" });

    await expect(queryFn({ queryKey: ["/api/me"] } as never)).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "Unauthorized",
    });
  });

  it("getQueryFn joins query keys and includes auth header", async () => {
    setBearerToken("jwt-token");

    const response = new Response(JSON.stringify({ id: 1 }), { status: 200 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    const queryFn = getQueryFn<{ id: number }>({ on401: "throw" });
    const result = await queryFn({ queryKey: ["/api", "games", "1"] } as never);

    expect(result).toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/games/1");
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer jwt-token");
  });

  it("queryClient default options disable retries and refetching", () => {
    const defaults = queryClient.getDefaultOptions();

    expect(defaults.queries?.retry).toBe(false);
    expect(defaults.queries?.refetchInterval).toBe(false);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.queries?.staleTime).toBe(Infinity);
    expect(defaults.queries?.queryFn).toBeTypeOf("function");
    expect(defaults.mutations?.retry).toBe(false);
  });

  it("clearSearchCache removes only /api/search query entries", () => {
    queryClient.setQueryData(["/api/search", "x"], { value: 1 });
    queryClient.setQueryData(["/api/search/something", "y"], { value: 2 });
    queryClient.setQueryData(["/api/indexers"], { value: 3 });
    queryClient.setQueryData([123], { value: 4 });

    clearSearchCache();

    expect(queryClient.getQueryData(["/api/search", "x"])).toBeUndefined();
    expect(queryClient.getQueryData(["/api/search/something", "y"])).toBeUndefined();
    expect(queryClient.getQueryData(["/api/indexers"])).toEqual({ value: 3 });
    expect(queryClient.getQueryData([123])).toEqual({ value: 4 });
  });
});
