import React, { createContext, useContext, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiFetch, apiRequest, setBearerToken } from "./queryClient";
import { useToast } from "@/hooks/use-toast";

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
 * login/setup, sent automatically via credentials: "include"). This runs
 * once, synchronously, before anything else in AuthProvider mounts: it
 * migrates a session that logged in before this change (localStorage-token
 * only, no cookie yet) into an in-memory bearer token for the current tab,
 * and scrubs the token out of localStorage immediately so it's no longer
 * sitting in persistent storage. New logins never write here again -- from
 * their perspective, everything after this migration is cookie-only.
 */
function migrateLegacyLocalStorageToken(): void {
  const legacyToken = localStorage.getItem("token");
  if (legacyToken) {
    setBearerToken(legacyToken);
    localStorage.removeItem("token");
  } else {
    // Deterministically reset the in-memory bearer token on every mount
    // (rather than only ever setting it), so a stale value from a prior
    // AuthProvider instance -- e.g. across remounts, or between tests --
    // can never leak into a session that has no legacy token to migrate.
    setBearerToken(null);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Lazy initializer runs during render, before any child effect (including
  // React Query's own fetch-triggering effects) can fire -- see
  // migrateLegacyLocalStorageToken's doc comment for why that ordering
  // matters. Neither the value nor the setter is needed -- only the
  // one-time initializer call -- so both are destructured out and unused.
  const [_migrationRan, _setMigrationRan] = useState(migrateLegacyLocalStorageToken);

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
      // in-memory bearer token here if migrateLegacyLocalStorageToken found
      // one for this tab.
      const res = await apiFetch("/api/auth/me");

      if (res.ok) {
        return await res.json();
      }

      if (res.status === 401 || res.status === 403) {
        setBearerToken(null);
        queryClient.clear();
        return null;
      }

      const error = new Error(
        `Failed to fetch authenticated user (${res.status})`
      ) as FetchUserError;
      error.status = res.status;
      throw error;
    },
    // Always attempt this -- a valid session may exist purely via the
    // httpOnly cookie, with nothing for the client to check beforehand.
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
      setUser(data.user);
    },
    onSuccess: () => {
      toast({ title: "Logged in successfully" });
      setLocation("/");
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
    setUser(null);
    queryClient.clear();
    setLocation("/login");
  };

  const checkSetup = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
  };

  // Redirect logic
  useEffect(() => {
    if (isCheckingSetup || isFetchingUser) return;

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
      setLocation("/login");
    } else if (isAuthenticated && (location === "/login" || location === "/setup")) {
      setLocation("/");
    }
  }, [
    user,
    meData,
    needsSetup,
    location,
    setLocation,
    isCheckingSetup,
    isFetchingUser,
    setupCheckError,
    toast,
  ]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading: isCheckingSetup || isFetchingUser || loginMutation.isPending,
        login,
        logout,
        needsSetup,
        checkSetup,
      }}
    >
      {children}
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
