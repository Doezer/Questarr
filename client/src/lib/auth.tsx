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

  const { isLoading: isCheckingSetup } = useQuery({
    queryKey: ["/api/auth/status"],
    queryFn: async () => {
      const res = await fetch("/api/auth/status");
      const data = await res.json();
      setNeedsSetup(!data.hasUsers);
      return data;
    },
  });

  const { isLoading: isFetchingUser } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      if (!token) return null;
      try {
        const res = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const userData = await res.json();
          setUser(userData);
          return userData;
        } else {
          setToken(null);
          localStorage.removeItem("token");
          return null;
        }
      } catch (err) {
        setToken(null);
        localStorage.removeItem("token");
        return null;
      }
    },
    enabled: !!token,
  });

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

    if (needsSetup && location !== "/setup") {
      setLocation("/setup");
    } else if (!needsSetup && !user && location !== "/login" && location !== "/setup") {
      setLocation("/login");
    } else if (user && (location === "/login" || location === "/setup")) {
      setLocation("/");
    }
  }, [user, needsSetup, location, setLocation, isCheckingSetup, isFetchingUser]);

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
