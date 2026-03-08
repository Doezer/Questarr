/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError, apiRequest, clearSearchCache, getQueryFn, queryClient } from "../queryClient";

describe("queryClient utilities", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
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

  it("apiRequest sends JSON body and authorization when token is present", async () => {
    localStorage.setItem("token", "jwt-token");

    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    const res = await apiRequest("POST", "/api/test", { hello: "world" });

    expect(res).toBe(response);
    expect(fetchMock).toHaveBeenCalledWith("/api/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer jwt-token",
      },
      body: JSON.stringify({ hello: "world" }),
      credentials: "include",
    });
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
    localStorage.setItem("token", "jwt-token");

    const response = new Response(JSON.stringify({ id: 1 }), { status: 200 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    const queryFn = getQueryFn<{ id: number }>({ on401: "throw" });
    const result = await queryFn({ queryKey: ["/api", "games", "1"] } as never);

    expect(result).toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/api/games/1", {
      headers: {
        Authorization: "Bearer jwt-token",
      },
      credentials: "include",
    });
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
