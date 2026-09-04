import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}

/** A freshly minted key also carries the raw secret, exactly once. */
interface CreatedApiKey extends ApiKeySummary {
  key: string;
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
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<ApiKeySummary | null>(null);

  const { data, isLoading } = useQuery<ApiKeySummary[]>({
    queryKey: ["/api/api-keys"],
  });

  // Guard the render against anything that isn't a list — a reverse proxy
  // returning an error body should not blank the whole Settings page.
  const keys = Array.isArray(data) ? data : [];

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/api-keys", { name });
      return (await res.json()) as CreatedApiKey;
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

  return (
    <Card id="api-keys">
      <CardHeader>
        <div className="flex items-center space-x-3">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">API Keys</CardTitle>
        </div>
        <CardDescription>
          Let external clients such as the Playnite extension sync your library and request games.
          Keys work only against the integration API and can be revoked at any time.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmedName) createMutation.mutate(trimmedName);
          }}
        >
          <div className="flex-1 space-y-2">
            <Label htmlFor="api-key-name">Name</Label>
            <Input
              id="api-key-name"
              placeholder="Playnite on the living room PC"
              value={newKeyName}
              maxLength={100}
              onChange={(e) => setNewKeyName(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!trimmedName || createMutation.isPending}>
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
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No API keys yet. Create one to connect the Playnite extension.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {keys.map((key) => (
                <li key={key.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{key.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
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
