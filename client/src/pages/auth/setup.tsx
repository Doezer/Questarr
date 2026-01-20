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
import { Lock, User, ShieldCheck, Gamepad2, HelpCircle, Info, ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type SetupForm = {
  username: string;
  password: string;
  confirmPassword: string;
  igdbClientId?: string;
  igdbClientSecret?: string;
};

export default function SetupPage() {
  const { checkSetup } = useAuth();
  const { toast } = useToast();
  // const [_, setLocation] = useLocation();

  const { data: config, isLoading: isLoadingConfig } = useQuery({
    queryKey: ["config"],
    queryFn: () => apiRequest("GET", "/api/config").then((res) => res.json()),
  });

  const setupSchema = useMemo(() => {
    const isIgdbConfigured = config?.igdb?.configured;

    return z
      .object({
        username: z.string().min(3, "Username must be at least 3 characters"),
        password: z.string().min(6, "Password must be at least 6 characters"),
        confirmPassword: z.string(),
        igdbClientId: isIgdbConfigured
          ? z.string().optional()
          : z.string().min(1, "IGDB Client ID is required"),
        igdbClientSecret: isIgdbConfigured
          ? z.string().optional()
          : z.string().min(1, "IGDB Client Secret is required"),
      })
      .refine((data) => data.password === data.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
      });
  }, [config]);

  const form = useForm<SetupForm>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      username: "",
      password: "",
      confirmPassword: "",
      igdbClientId: "",
      igdbClientSecret: "",
    },
  });

  const setupMutation = useMutation({
    mutationFn: async (data: SetupForm) => {
      const res = await apiRequest("POST", "/api/auth/setup", {
        username: data.username,
        password: data.password,
        igdbClientId: data.igdbClientId,
        igdbClientSecret: data.igdbClientSecret,
      });
      return res.json();
    },
    onSuccess: async (data) => {
      localStorage.setItem("token", data.token);
      await checkSetup();
      toast({ title: "Setup complete! Welcome." });
      // Force reload to pick up auth state or navigate
      window.location.href = "/";
    },
    onError: (error: Error) => {
      toast({
        title: "Setup failed",
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

              {config && !config.igdb.configured && (
                <>
                  <div className="border-t my-4 pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-medium flex items-center gap-2">
                        <Gamepad2 className="h-4 w-4" />
                        IGDB Configuration
                      </h3>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full">
                            <HelpCircle className="h-4 w-4 text-muted-foreground" />
                            <span className="sr-only">How to get credentials</span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80">
                          <div className="space-y-2 text-sm">
                            <h4 className="font-bold">How to get IGDB credentials:</h4>
                            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                              <li>
                                Go to the{" "}
                                <a
                                  href="https://dev.twitch.tv/console"
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary underline"
                                >
                                  Twitch Developer Portal
                                </a>
                              </li>
                              <li>Register a new application (name it 'Questarr')</li>
                              <li>
                                Set Redirect URI to{" "}
                                <code className="bg-muted px-1">http://localhost</code>
                              </li>
                              <li>Select 'Application Integration' as category</li>
                              <li>
                                Copy the <strong>Client ID</strong>
                              </li>
                              <li>
                                Click 'New Secret' to get your <strong>Client Secret</strong>
                              </li>
                            </ol>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                      IGDB credentials are required to discover and import games.
                    </p>
                  </div>

                  <FormField
                    control={form.control}
                    name="igdbClientId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Client ID</FormLabel>
                        <FormControl>
                          <Input placeholder="IGDB Client ID" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="igdbClientSecret"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Client Secret</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="IGDB Client Secret" {...field} />
                        </FormControl>
                        <FormMessage />
                        <FormDescription>
                          <a
                            href="https://api-docs.igdb.com/#account-creation"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                          >
                            How to get IGDB credentials
                          </a>
                        </FormDescription>
                      </FormItem>
                    )}
                  />
                </>
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
