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

// Auth is primarily cookie-based (httpOnly JWT cookie set by the server on
// login/setup, sent automatically via credentials: "include" below). This
// in-memory-only bearer token exists solely to bridge a browser session that
// was already logged in via the old localStorage-token flow across the
// migration to cookies, without stranding it -- see auth.tsx, which is the
// only caller of setBearerToken. New logins never populate this; it is never
// written to localStorage or any other persistent storage.
let inMemoryBearerToken: string | null = null;
export function setBearerToken(token: string | null): void {
  inMemoryBearerToken = token;
}

// Must match CSRF_COOKIE_NAME in server/security.ts. Kept as a plain literal
// (not imported) since client and server are separate bundles.
const CSRF_COOKIE_NAME = "questarr_csrf";

function getCsrfTokenFromCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

/** Set `name: value` on a HeadersInit of any shape, without overwriting a value the caller already set explicitly. */
function withHeader(headers: HeadersInit | undefined, name: string, value: string): HeadersInit {
  if (!headers) {
    return { [name]: value };
  }

  if (headers instanceof Headers) {
    const newHeaders = new Headers(headers);
    if (!newHeaders.has(name)) {
      newHeaders.set(name, value);
    }
    return newHeaders;
  }

  if (Array.isArray(headers)) {
    const hasHeader = headers.some(([key]) => key.toLowerCase() === name.toLowerCase());
    return hasHeader ? headers : [...headers, [name, value]];
  }

  const hasHeader = Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
  return hasHeader ? headers : { ...headers, [name]: value };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let headers = init.headers;

  if (inMemoryBearerToken) {
    headers = withHeader(headers, "Authorization", `Bearer ${inMemoryBearerToken}`);
  }

  // Attach the double-submit CSRF token on state-changing requests when the
  // (non-httpOnly, readable) CSRF cookie is present -- i.e. whenever this
  // session is cookie-authenticated. Bearer-only sessions have no CSRF
  // cookie, so this is a no-op for them (the server also skips CSRF
  // enforcement for bearer-authenticated requests, see server/security.ts).
  const method = (init.method || "GET").toUpperCase();
  if (!SAFE_METHODS.has(method)) {
    const csrfToken = getCsrfTokenFromCookie();
    if (csrfToken) {
      headers = withHeader(headers, "X-CSRF-Token", csrfToken);
    }
  }

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
