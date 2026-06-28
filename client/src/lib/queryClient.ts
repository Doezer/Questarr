import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { withBasePath } from "@/lib/app-path";

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    const raw =
      (data as Record<string, unknown>)?.error ||
      (data as Record<string, unknown>)?.message ||
      res.statusText ||
      String(res.status);
    const message = typeof raw === "string" ? raw : JSON.stringify(raw);
    throw new ApiError(res.status, message, data);
  }
}

function withAuthorization(headers?: HeadersInit): HeadersInit | undefined {
  const token = localStorage.getItem("token");
  if (!token) {
    return headers;
  }

  const authorization = `Bearer ${token}`;

  if (!headers) {
    return { Authorization: authorization };
  }

  if (headers instanceof Headers) {
    const newHeaders = new Headers(headers);
    if (!newHeaders.has("Authorization")) {
      newHeaders.set("Authorization", authorization);
    }
    return newHeaders;
  }

  if (Array.isArray(headers)) {
    const hasAuthorization = headers.some(([key]) => key.toLowerCase() === "authorization");
    return hasAuthorization ? headers : [...headers, ["Authorization", authorization]];
  }

  const hasAuthorization = Object.keys(headers).some(
    (key) => key.toLowerCase() === "authorization"
  );
  return hasAuthorization ? headers : { ...headers, Authorization: authorization };
}

export function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = withAuthorization(init.headers);

  return fetch(withBasePath(url), {
    ...init,
    headers,
    credentials: init.credentials ?? "include",
  });
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined
): Promise<Response> {
  const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};

  const res = await apiFetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: { on401: UnauthorizedBehavior }) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await apiFetch(queryKey.join("/") as string, {
      headers: {},
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Removes all cached torrent/NZB search results from the query cache.
 * Should be called whenever the set of configured indexers changes so that
 * the next download search fetches fresh data from all active indexers.
 */
export function clearSearchCache(): void {
  queryClient.removeQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      return typeof key === "string" && key.startsWith("/api/search");
    },
  });
}
