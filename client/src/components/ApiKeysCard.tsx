import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { copyToClipboard } from "@/lib/utils";
import {
  apiKeyListResponseSchema,
  apiKeyCreatedResponseSchema,
  type ApiKeyPublicResponse,
  type ApiKeyCreatedResponse,
  type ApiKeyScope,
} from "@shared/schema";

const SCOPE_OPTIONS: { value: ApiKeyScope; label: string; description: string }[] = [
  {
    value: "integration:playnite",
    label: "Playnite extension",
    description: "Ping, read the library, sync and request games",
  },
  {
    value: "integration:read",
    label: "Read only",
    description: "Ping and read the library (dashboards, widgets)",
  },
  {
    value: "integration:seerrng",
    label: "SeerrNG provider",
    description: "Let SeerrNG browse the catalog and request PC games",
  },
  {
    value: "integration:all",
    label: "All integration routes",
    description: "Everything the integration API offers",
  },
];

const SCOPE_LABELS: Record<ApiKeyScope, string> = {
  "integration:playnite": "Playnite",
  "integration:read": "Read only",
  "integration:seerrng": "SeerrNG",
  "integration:all": "All routes",
};

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_WARNING_DAYS = 14;

type ExpiryState = { label: string; tone: "none" | "ok" | "warning" | "expired" };

function describeExpiry(expiresAt: string | null, now = Date.now()): ExpiryState {
  if (!expiresAt) return { label: "No expiry", tone: "none" };
  const time = new Date(expiresAt).getTime();
  if (Number.isNaN(time)) return { label: "No expiry", tone: "none" };
  const daysLeft = Math.ceil((time - now) / DAY_MS);
  if (time <= now) return { label: "Expired", tone: "expired" };
  return {
    label: `Expires in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`,
    tone: daysLeft < EXPIRY_WARNING_DAYS ? "warning" : "ok",
  };
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

/**
 * Manages the long-lived API keys used by external clients (the Playnite
 * extension, scripts). The raw key is shown only in the panel that appears
 * right after creation — the server stores a hash and cannot show it again.
 */
export function ApiKeysCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScope, setNewKeyScope] = useState<ApiKeyScope>("integration:playnite");
  const [newKeyExpiry, setNewKeyExpiry] = useState("365");
  const [createdKey, setCreatedKey] = useState<ApiKeyCreatedResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<ApiKeyPublicResponse | null>(null);

  const {
    data: keys = [],
    isLoading,
    isError,
  } = useQuery<ApiKeyPublicResponse[]>({
    queryKey: ["/api/api-keys"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/api-keys");
      return apiKeyListResponseSchema.parse(await res.json());
    },
  });

  const createMutation = useMutation({
    mutationFn: async (input: {
      name: string;
      scope: ApiKeyScope;
      expiresInDays: number | null;
    }) => {
      const res = await apiRequest("POST", "/api/api-keys", input);
      return apiKeyCreatedResponseSchema.parse(await res.json());
    },
    onSuccess: (created) => {
      setCreatedKey(created);
      setCopied(false);
      setNewKeyName("");
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not create API key",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/api-keys/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({ title: "API key revoked" });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not revoke API key",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => setPendingRevoke(null),
  });

  const handleCopy = useCallback(async () => {
    if (!createdKey) return;
    const ok = await copyToClipboard(createdKey.key);
    if (ok) {
      setCopied(true);
      return;
    }
    toast({
      title: "Copy failed",
      description: "Select the key and copy it manually.",
      variant: "destructive",
    });
  }, [createdKey, toast]);

  const trimmedName = newKeyName.trim();
  const expiryByKey = useMemo(
    () => new Map(keys.map((key) => [key.id, describeExpiry(key.expiresAt)])),
    [keys]
  );

  return (
    <Card id="api-keys">
      <CardHeader>
        <div className="flex items-center space-x-3">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">API Keys</CardTitle>
        </div>
        <CardDescription>
          Let external clients such as the Playnite extension sync your library and request games.
          Each key is limited to the access you choose, only works against the integration API, and
          can be revoked at any time.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmedName) {
              createMutation.mutate({
                name: trimmedName,
                scope: newKeyScope,
                expiresInDays: newKeyExpiry === "never" ? null : Number(newKeyExpiry),
              });
            }
          }}
        >
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="api-key-name">Name</Label>
            <Input
              id="api-key-name"
              placeholder="Playnite on the living room PC"
              value={newKeyName}
              maxLength={100}
              onChange={(e) => setNewKeyName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="api-key-scope">Access</Label>
            <Select value={newKeyScope} onValueChange={(v) => setNewKeyScope(v as ApiKeyScope)}>
              <SelectTrigger id="api-key-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {SCOPE_OPTIONS.find((o) => o.value === newKeyScope)?.description}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="api-key-expiry">Expires</Label>
            <Select value={newKeyExpiry} onValueChange={setNewKeyExpiry}>
              <SelectTrigger id="api-key-expiry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              An expired key stops working until you create a new one.
            </p>
          </div>
          <Button
            type="submit"
            className="sm:col-span-2 sm:justify-self-start"
            disabled={!trimmedName || createMutation.isPending}
          >
            <Plus className="mr-2 h-4 w-4" />
            {createMutation.isPending ? "Creating..." : "Create key"}
          </Button>
        </form>

        {createdKey && (
          <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-4">
            <p className="text-sm font-medium">
              Copy your new key now — it will not be shown again.
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={createdKey.key}
                aria-label="New API key"
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleCopy}
                aria-label="Copy API key"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setCreatedKey(null)}>
              Done
            </Button>
          </div>
        )}

        <section aria-labelledby="api-keys-list-heading" className="space-y-2">
          <h3 id="api-keys-list-heading" className="text-sm font-medium">
            Active keys
          </h3>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : isError ? (
            <p className="text-sm text-destructive">
              Could not load API keys. Refresh the page to try again.
            </p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No API keys yet. Create one to connect the Playnite extension.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {keys.map((key) => (
                <li key={key.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{key.name}</p>
                      <Badge variant="secondary">{SCOPE_LABELS[key.scope]}</Badge>
                      <Badge
                        variant={
                          expiryByKey.get(key.id)?.tone === "expired" ? "destructive" : "outline"
                        }
                        className={
                          expiryByKey.get(key.id)?.tone === "warning"
                            ? "border-amber-500 text-amber-500"
                            : undefined
                        }
                      >
                        {expiryByKey.get(key.id)?.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{key.prefix}…</span> · Created{" "}
                      {formatDate(key.createdAt)} · Last used {formatDate(key.lastUsedAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Revoke API key ${key.name}`}
                    onClick={() => setPendingRevoke(key)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>

      <AlertDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => !open && setPendingRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this API key?</AlertDialogTitle>
            <AlertDialogDescription>
              Any client using “{pendingRevoke?.name}” will stop working immediately. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingRevoke && revokeMutation.mutate(pendingRevoke.id)}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
