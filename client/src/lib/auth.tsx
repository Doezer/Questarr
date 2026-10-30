import React, { createContext, useContext, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiFetch, apiRequest, setBearerToken } from "./queryClient";
import { disconnectSocket } from "./socket";
import { useToast } from "@/hooks/use-toast";
import { loginDestination } from "./login-destination";

type User = {
  id: string;
  username: string;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  login: (credentials: { username: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  needsSetup: boolean;
  checkSetup: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

type FetchUserError = Error & { status?: number };

/**
 * Auth is primarily cookie-based (httpOnly JWT cookie set by the server on
 * login/setup, sent automatically via credentials: "include"). Sessions that
 * logged in before this change only have a localStorage token (no cookie
 * yet). Reading it is side-effect free, so it is safe to do during render;
 * the actual migration (below) runs after commit.
 */
function readLegacyLocalStorageToken(): string | null {
  try {
    return localStorage.getItem("token");
  } catch {
    return null;
  }
}

/**
 * Post-commit migration of the legacy token: carries it forward as an
 * in-memory bearer token for the current tab and scrubs it out of
 * localStorage so it no longer sits in persistent storage. Idempotent: the
 * token is captured once at render time, so re-running this (StrictMode's
 * dev-only effect re-invocation) re-applies the same value instead of
 * resetting it to null once localStorage has been scrubbed.
 */
function migrateLegacyLocalStorageToken(legacyToken: string | null): void {
  if (legacyToken) {
    setBearerToken(legacyToken);
    try {
      localStorage.removeItem("token");
    } catch {
      // Storage unavailable: nothing to scrub.
    }
  } else {
    // Deterministically reset the in-memory bearer token on every mount
    // (rather than only ever setting it), so a stale value from a prior
    // AuthProvider instance -- e.g. across remounts, or between tests --
    // can never leak into a session that has no legacy token to migrate.
    setBearerToken(null);
  }
}

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const destination = loginDestination(search);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Captured once, without side effects (a lazy initializer may be invoked
  // twice under StrictMode, which is harmless for a read).
  const [legacyToken] = useState(readLegacyLocalStorageToken);
  const [migrated, setMigrated] = useState(false);

  // Post-commit migration. Children are not rendered and "/api/auth/me" is
  // not enabled until it completes, so no request can go out before the
  // migrated bearer token is in place.
  useEffect(() => {
    migrateLegacyLocalStorageToken(legacyToken);
    setMigrated(true);
  }, [legacyToken]);

  const {
    isLoading: isCheckingSetup,
    error: setupCheckError,
    data: statusData,
  } = useQuery({
    queryKey: ["/api/auth/status"],
    queryFn: async () => {
      const res = await apiFetch("/api/auth/status");
      if (!res.ok) {
        throw new Error("Failed to check setup status");
      }
      return await res.json();
    },
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    staleTime: 60000, // Cache for 1 minute to avoid excessive checks
    refetchOnMount: "always",
  });

  // Derive needsSetup from query data
  useEffect(() => {
    if (statusData) {
      setNeedsSetup(!statusData.hasUsers);
    }
  }, [statusData]);

  const { isLoading: isFetchingUser, data: meData } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      // No Authorization header needed for the common case -- the httpOnly
      // auth cookie is sent automatically. apiFetch also attaches an
      // in-memory bearer token here if the legacy-token migration found
      // one for this tab.
      const res = await apiFetch("/api/auth/me");

      if (res.ok) {
        return await res.json();
      }

      if (res.status === 401 || res.status === 403) {
        setBearerToken(null);
        // Drop every other cached query (stale authenticated data from a
        // prior session) but deliberately spare "/api/auth/status" and this
        // query itself -- removing a query while its fetch is in flight
        // strands its observers (setup/config screens, the login button via
        // isFetchingUser) on an indefinite loading state instead of letting
        // them re-resolve once the fetch settles (to null, here).
        queryClient.removeQueries({
          predicate: (query) =>
            query.queryKey[0] !== "/api/auth/status" && query.queryKey[0] !== "/api/auth/me",
        });
        return null;
      }

      const error = new Error(
        `Failed to fetch authenticated user (${res.status})`
      ) as FetchUserError;
      error.status = res.status;
      throw error;
    },
    // Always attempt this once legacy-token migration has completed -- a
    // valid session may exist purely via the httpOnly cookie, with nothing
    // for the client to check beforehand.
    enabled: migrated,
    retry: (failureCount, error) => {
      const status = (error as FetchUserError).status;
      if (typeof status === "number") {
        if (status === 401 || status === 403) return false;
        if (status < 500) return false;
      }
      return failureCount < 3;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    staleTime: 30000, // 30 seconds — re-validate session periodically
    refetchOnMount: "always", // Always re-validate on AuthProvider mount
  });

  // Derive user from query data so it stays in sync even when served from cache
  useEffect(() => {
    if (meData) {
      setUser(meData);
    } else if (meData === null) {
      setUser(null);
    }
  }, [meData]);

  const loginMutation = useMutation({
    mutationFn: async (credentials: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", credentials);
      const data = await res.json();
      // The server has already set the httpOnly auth + CSRF cookies; nothing
      // to store client-side. `data.token` is still returned for backward
      // compatibility with non-browser bearer clients, but the browser
      // client itself never persists it.
      //
      // Also clear any in-memory bearer token migrated from a pre-cookie
      // session (see migrateLegacyLocalStorageToken): the Authorization
      // header takes priority over the cookie on every subsequent request,
      // so a stale/invalid migrated bearer left in place would keep
      // clobbering this fresh, valid cookie session on every later
      // /api/auth/me check.
      setBearerToken(null);
      // Keep the "/api/auth/me" cache in step with the new session: cancel any
      // in-flight check first so a late 401 from before login can't land on
      // top and null the user out again.
      await queryClient.cancelQueries({ queryKey: ["/api/auth/me"] });
      queryClient.setQueryData(["/api/auth/me"], data.user);
      setUser(data.user);
    },
    onSuccess: () => {
      toast({ title: "Logged in successfully" });
      setLocation(destination);
    },
    onError: (error: Error) => {
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const login = async (credentials: { username: string; password: string }) => {
    await loginMutation.mutateAsync(credentials);
  };

  const logout = async () => {
    // Wait for the server to actually clear the httpOnly session cookie
    // before dropping local state. If this fails (network error, 500,
    // etc.), the server-side session is still live, so acting as if we'd
    // logged out would let a later page load / auth/me check silently
    // restore it -- leave local state untouched and let the user retry.
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch (error) {
      toast({
        title: "Logout failed",
        description:
          error instanceof Error
            ? error.message
            : "Unable to reach the server. Please check your connection and try again.",
        variant: "destructive",
      });
      return;
    }
    setBearerToken(null);
    disconnectSocket();
    setUser(null);
    queryClient.clear();
    setLocation("/login");
  };

  const checkSetup = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
  };

  // Redirect logic
  useEffect(() => {
    if (!migrated || isCheckingSetup || isFetchingUser) return;

    // Show error if setup check failed after retries
    if (setupCheckError) {
      toast({
        title: "Connection Error",
        description: "Unable to connect to the server. Please check your connection and refresh.",
        variant: "destructive",
      });
      return;
    }

    // Fall back to meData directly: on the render where isFetchingUser first flips to
    // false, the "derive user" effect above hasn't flushed its setUser call yet, so
    // `user` can still be stale. Reading meData here avoids acting on that stale value.
    const isAuthenticated = !!(user ?? meData);

    if (needsSetup && location !== "/setup") {
      setLocation("/setup");
    } else if (!needsSetup && !isAuthenticated && location !== "/login" && location !== "/setup") {
      const next = `${location}${search ? `?${search}` : ""}${window.location.hash}`;
      setLocation(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
    } else if (isAuthenticated && (location === "/login" || location === "/setup")) {
      setLocation(location === "/login" ? destination : "/");
    }
  }, [
    user,
    meData,
    needsSetup,
    location,
    search,
    destination,
    setLocation,
    isCheckingSetup,
    isFetchingUser,
    migrated,
    setupCheckError,
    toast,
  ]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading: !migrated || isCheckingSetup || isFetchingUser || loginMutation.isPending,
        login,
        logout,
        needsSetup,
        checkSetup,
      }}
    >
      {migrated ? children : null}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
