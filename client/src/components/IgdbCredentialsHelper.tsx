import { useState, useCallback } from "react";
import { Copy, Check, HelpCircle, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiRequest, ApiError } from "@/lib/queryClient";

const IGDB_REDIRECT_URI = "http://localhost";

/**
 * "?" popover explaining how to get IGDB/Twitch credentials, shared between the setup wizard
 * and the settings page so the two copies of these instructions can't drift out of sync.
 * Includes a copy button for the redirect URI (the one field most often mistyped) and a short
 * explanation of why Questarr can't ship a working credential out of the box: Twitch requires
 * every application to register its own Client ID/Secret, and a secret baked into an
 * open-source app's code would be public the moment it's committed.
 */
export function IgdbHelpPopover() {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(IGDB_REDIRECT_URI)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Clipboard access can be denied (permissions, non-HTTPS context); the URI is
        // still visible in the text for the user to select and copy manually.
      });
  }, []);

  return (
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
            <li>Register a new application (name it &apos;Questarr&apos;)</li>
            <li>
              Set Redirect URI to <code className="bg-muted px-1">{IGDB_REDIRECT_URI}</code>{" "}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5 align-middle"
                onClick={handleCopy}
                aria-label="Copy redirect URI"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground" />
                )}
              </Button>
            </li>
            <li>Select &apos;Application Integration&apos; as category</li>
            <li>
              Copy the <strong>Client ID</strong>
            </li>
            <li>
              Click &apos;New Secret&apos; to get your <strong>Client Secret</strong>
            </li>
          </ol>
          <p className="text-xs text-muted-foreground border-t pt-2 mt-2">
            Questarr can&apos;t ship a working credential out of the box: Twitch requires every
            application to register its own Client ID/Secret, and a secret baked into
            Questarr&apos;s open-source code would be public the moment it&apos;s committed.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type TestResult = { success: true } | { success: false; error: string };

interface IgdbTestConnectionButtonProps {
  clientId: string;
  clientSecret: string;
  /** Endpoint to POST { clientId, clientSecret } to; must respond with { success, error? }. */
  testEndpoint: string;
}

/**
 * "Test connection" button: verifies a Client ID/Secret pair against Twitch/IGDB before the
 * user saves it (settings) or finishes setup, so a typo or expired secret is caught
 * immediately instead of surfacing later as a failed game search.
 */
export function IgdbTestConnectionButton({
  clientId,
  clientSecret,
  testEndpoint,
}: IgdbTestConnectionButtonProps) {
  const [state, setState] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleTest = useCallback(async () => {
    setState("testing");
    setErrorMessage(null);
    try {
      // apiRequest throws on a non-2xx response (e.g. a 400 for invalid credentials), so the
      // server's { success: false, error } body only reaches us via the thrown ApiError below,
      // not through a resolved response — a 400 here is an expected, valid test outcome.
      const res = await apiRequest("POST", testEndpoint, { clientId, clientSecret });
      const result: TestResult = await res.json();
      if (result.success) {
        setState("success");
      } else {
        setState("error");
        setErrorMessage(result.error);
      }
    } catch (error) {
      setState("error");
      setErrorMessage(
        error instanceof ApiError
          ? error.message
          : "Could not reach the server to test the connection."
      );
    }
  }, [clientId, clientSecret, testEndpoint]);

  const disabled = state === "testing" || !clientId.trim() || !clientSecret.trim();

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleTest}
        disabled={disabled}
        className="gap-2"
      >
        {state === "testing" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Testing...
          </>
        ) : (
          "Test connection"
        )}
      </Button>
      {state === "success" && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-500">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Connected successfully.
        </p>
      )}
      {state === "error" && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <XCircle className="h-3.5 w-3.5 shrink-0" />
          {errorMessage ?? "Connection failed."}
        </p>
      )}
    </div>
  );
}
