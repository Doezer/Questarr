import React, { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
// import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Lock, User, ShieldCheck, Gamepad2, Info, ExternalLink } from "lucide-react";
import { withBasePath } from "@/lib/app-path";
import { passwordPolicySchema } from "@shared/schema";

type SetupForm = {
  username: string;
  password: string;
  confirmPassword: string;
  rawgApiKey?: string | undefined;
};

export default function SetupPage() {
  const { checkSetup } = useAuth();
  const { toast } = useToast();
  // const [_, setLocation] = useLocation();

  // GET /api/config requires authentication, which doesn't exist yet during
  // setup, so the provider-configured status is read from the unauthenticated
  // GET /api/auth/status endpoint instead (shares the query cache with
  // AuthProvider's own status check).
  const { data: statusData, isLoading: isLoadingConfig } = useQuery({
    queryKey: ["/api/auth/status"],
    queryFn: () => apiRequest("GET", "/api/auth/status").then((res) => res.json()),
  });
  const config = statusData;

  const setupSchema = useMemo(() => {
    const isRawgConfigured = !!config?.rawg?.configured;

    return z
      .object({
        username: z.string().min(3, "Username must be at least 3 characters"),
        password: passwordPolicySchema,
        confirmPassword: z.string().trim(),
        rawgApiKey: z.string().optional(),
      })
      .refine((data) => data.password === data.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
      })
      .refine((data) => isRawgConfigured || !!data.rawgApiKey?.trim(), {
        message: "Enter a RAWG API key (free at rawg.io).",
        path: ["rawgApiKey"],
      });
  }, [config]);

  const form = useForm<SetupForm>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      username: "",
      password: "",
      confirmPassword: "",
      rawgApiKey: "",
    },
  });

  const setupMutation = useMutation({
    mutationFn: async (data: SetupForm) => {
      const res = await apiRequest("POST", "/api/auth/setup", {
        username: data.username,
        password: data.password,
        rawgApiKey: data.rawgApiKey,
      });
      return res.json();
    },
    onSuccess: async () => {
      // The server has already set the httpOnly auth cookie; nothing to
      // store client-side (see server/security.ts's setAuthCookies).
      await checkSetup();
      toast({ title: "Setup complete! Welcome." });
      // Force reload to pick up auth state or navigate
      window.location.href = withBasePath("/");
    },
    onError: (error: Error) => {
      toast({
        title: "Setup failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const testRawgMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/setup/test-rawg", {
        apiKey: form.getValues("rawgApiKey")?.trim() ?? "",
      });
      return res.json() as Promise<{ success: boolean; error?: string }>;
    },
    onSuccess: (result) => {
      toast({
        title: result.success ? "RAWG connection successful" : "RAWG connection failed",
        description: result.success ? "The API key is valid." : result.error,
        variant: result.success ? "default" : "destructive",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "RAWG connection failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: SetupForm) => {
    setupMutation.mutate(data);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 gap-6">
      <Alert className="max-w-md border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <Info className="h-4 w-4" />
        <AlertTitle>Upgrading from v1.0?</AlertTitle>
        <AlertDescription>
          <div className="mt-2 text-sm space-y-2">
            <p>
              If you are upgrading from an older version (PostgreSQL),{" "}
              <strong>do not create a new account</strong>.
            </p>
            <p>
              You must migrate your data to the new database format first, otherwise your library
              will be empty.
            </p>
            <a
              href="https://github.com/Doezer/Questarr/blob/main/docs/MIGRATION.md"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold underline underline-offset-4 hover:text-amber-800 dark:hover:text-amber-300 transition-colors"
            >
              Read Migration Guide <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </AlertDescription>
      </Alert>

      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto bg-primary/10 p-3 rounded-full w-fit mb-2">
            <ShieldCheck className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">Initial Setup</CardTitle>
          <CardDescription>Create your admin account to get started</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <div className="relative">
                      <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <FormControl>
                        <Input className="pl-9" placeholder="Choose a username" {...field} />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <FormControl>
                        <Input
                          type="password"
                          className="pl-9"
                          placeholder="Choose a password"
                          {...field}
                        />
                      </FormControl>
                    </div>
                    <FormDescription>
                      At least 8 characters, including one letter and one number.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <FormControl>
                        <Input
                          type="password"
                          className="pl-9"
                          placeholder="Confirm your password"
                          {...field}
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {config && !config.rawg?.configured && (
                <div className="border-t my-4 pt-4">
                  <h3 className="font-medium flex items-center gap-2 mb-2">
                    <Gamepad2 className="h-4 w-4" />
                    Game Metadata Provider
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Questarr uses RAWG for game search, discovery, and metadata. You can also add
                    the key later in Settings.
                  </p>

                  <div className="space-y-3">
                    <h4 className="font-medium">RAWG</h4>
                    <FormField
                      control={form.control}
                      name="rawgApiKey"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>API Key</FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              placeholder="RAWG API key"
                              autoComplete="new-password"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            Get a free key at{" "}
                            <a
                              href="https://rawg.io/apidocs"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-2"
                            >
                              rawg.io/apidocs
                            </a>
                            .
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => testRawgMutation.mutate()}
                      disabled={testRawgMutation.isPending || !form.watch("rawgApiKey")?.trim()}
                    >
                      {testRawgMutation.isPending ? "Testing..." : "Test RAWG key"}
                    </Button>
                  </div>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={setupMutation.isPending || isLoadingConfig}
              >
                {isLoadingConfig
                  ? "Loading..."
                  : setupMutation.isPending
                    ? "Creating Account..."
                    : "Create Account"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
