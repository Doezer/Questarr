import React, { createContext, useContext, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "./queryClient";
import { useToast } from "@/hooks/use-toast";

type User = {
  id: string;
  username: string;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  login: (credentials: { username: string; password: string }) => Promise<void>;
  logout: () => void;
  needsSetup: boolean;
  checkSetup: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem("token"));
  const [needsSetup, setNeedsSetup] = useState(false);
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    isLoading: isCheckingSetup,
    error: setupCheckError,
    data: statusData,
  } = useQuery({
    queryKey: ["/api/auth/status"],
    queryFn: async () => {
      const res = await fetch("/api/auth/status");
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
    queryKey: ["/api/auth/me", token],
    queryFn: async () => {
      // Read token directly from localStorage for freshness
      const currentToken = localStorage.getItem("token");
      if (!currentToken) return null;
      try {
        const res = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${currentToken}` },
        });
        if (res.ok) {
          return await res.json();
        } else {
          localStorage.removeItem("token");
          setToken(null);
          return null;
        }
      } catch {
        localStorage.removeItem("token");
        setToken(null);
        return null;
      }
    },
    enabled: !!token,
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
      localStorage.setItem("token", data.token);
      setToken(data.token);
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

  const logout = () => {
    localStorage.removeItem("token");
    setToken(null);
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

    if (needsSetup && location !== "/setup") {
      setLocation("/setup");
    } else if (!needsSetup && !user && location !== "/login" && location !== "/setup") {
      setLocation("/login");
    } else if (user && (location === "/login" || location === "/setup")) {
      setLocation("/");
    }
  }, [
    user,
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
