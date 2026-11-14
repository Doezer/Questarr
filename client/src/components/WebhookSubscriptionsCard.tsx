import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, Plus, Send, Trash2, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface WebhookSubscription {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
}

interface WebhookListResponse {
  subscriptions: WebhookSubscription[];
  events: string[];
}

interface WebhookDelivery {
  id: string;
  eventId: string;
  eventType: string;
  attempt: number;
  statusCode: number | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string | null;
}

const EVENT_LABELS: Record<string, string> = {
  "download.completed": "Download completed",
  "download.failed": "Download failed",
  "import.failed": "Import failed",
  "game.released": "Game released",
  "game.delayed": "Game delayed",
};

const QUERY_KEY = ["/api/webhooks"];

function DeliveryLog({ id }: { id: string }) {
  const { data, isLoading, isError, refetch } = useQuery<WebhookDelivery[]>({
    queryKey: [`/api/webhooks/${id}/deliveries`],
    queryFn: () => apiRequest("GET", `/api/webhooks/${id}/deliveries`).then((r) => r.json()),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (isError) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-red-400" role="alert">
        <span>Could not load deliveries.</span>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">No delivery attempts yet.</p>;
  }
  return (
    <ul className="space-y-1 text-sm" aria-label="Recent delivery attempts">
      {data.map((d) => {
        const ok = d.statusCode !== null && d.statusCode >= 200 && d.statusCode < 300;
        return (
          <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge
              variant="outline"
              className={
                ok
                  ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
                  : "border-red-500/30 bg-red-500/20 text-red-400"
              }
            >
              {d.statusCode ?? "error"}
            </Badge>
            <span>{EVENT_LABELS[d.eventType] ?? d.eventType}</span>
            <span className="text-muted-foreground">
              attempt {d.attempt}
              {d.error && !ok ? ` · ${d.error}` : ""}
            </span>
            {d.createdAt && (
              <span className="text-muted-foreground sm:ml-auto">
                {new Date(d.createdAt).toLocaleString()}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function WebhookRow({
  sub,
  onToggle,
  onTest,
  onDelete,
  testing,
}: {
  sub: WebhookSubscription;
  onToggle: (sub: WebhookSubscription, enabled: boolean) => void;
  onTest: (sub: WebhookSubscription) => void;
  onDelete: (sub: WebhookSubscription) => void;
  testing: boolean;
}) {
  return (
    <div className="space-y-3 rounded-md border p-3" data-testid={`webhook-row-${sub.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{sub.name}</p>
          <p className="break-all text-sm text-muted-foreground">{sub.url}</p>
        </div>
        <Switch
          checked={sub.enabled}
          onCheckedChange={(checked) => onToggle(sub, checked)}
          aria-label={`${sub.enabled ? "Disable" : "Enable"} webhook ${sub.name}`}
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {sub.events.map((event) => (
          <Badge key={event} variant="secondary">
            {EVENT_LABELS[event] ?? event}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 sm:min-h-9"
          onClick={() => onTest(sub)}
          disabled={testing}
        >
          <Send className="mr-2 h-4 w-4" />
          {testing ? "Sending…" : "Send test"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 sm:min-h-9"
          onClick={() => onDelete(sub)}
          aria-label={`Delete webhook ${sub.name}`}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </Button>
      </div>
      <Collapsible>
        <CollapsibleTrigger className="group flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
          <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
          Recent deliveries
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <DeliveryLog id={sub.id} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/**
 * Outbound webhook subscriptions: external automation receives signed JSON events. Sits in the
 * notification settings next to Apprise; the Discord webhook on the Stats page is a separate,
 * single-purpose integration.
 */
export default function WebhookSubscriptionsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [testingIds, setTestingIds] = useState<ReadonlySet<string>>(new Set());

  const { data } = useQuery<WebhookListResponse>({
    queryKey: QUERY_KEY,
    queryFn: () => apiRequest("GET", "/api/webhooks").then((r) => r.json()),
  });
  const subscriptions = data?.subscriptions ?? [];
  const availableEvents = data?.events ?? Object.keys(EVENT_LABELS);

  const resetForm = useCallback(() => {
    setName("");
    setUrl("");
    setEvents([]);
  }, []);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/webhooks", {
        name: name.trim(),
        url: url.trim(),
        events,
      });
      return (await res.json()) as WebhookSubscription & { secret: string };
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setCreatedSecret(created.secret);
      setCopied(false);
      resetForm();
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: `Failed to add webhook: ${err.message}`, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      await apiRequest("PATCH", `/api/webhooks/${id}`, { enabled });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (err: Error) => {
      toast({ title: `Failed to update webhook: ${err.message}`, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/webhooks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: "Webhook deleted" });
    },
    onError: (err: Error) => {
      toast({ title: `Failed to delete webhook: ${err.message}`, variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      setTestingIds((prev) => new Set(prev).add(id));
      await apiRequest("POST", `/api/webhooks/${id}/test`);
      return id;
    },
    onSuccess: (id) => {
      toast({ title: "Test event delivered" });
      queryClient.invalidateQueries({ queryKey: [`/api/webhooks/${id}/deliveries`] });
    },
    onError: (err: Error, id) => {
      toast({ title: `Test failed: ${err.message}`, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: [`/api/webhooks/${id}/deliveries`] });
    },
    onSettled: (_data, _err, id) =>
      setTestingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
  });

  const handleToggle = useCallback(
    (sub: WebhookSubscription, enabled: boolean) => toggleMutation.mutate({ id: sub.id, enabled }),
    [toggleMutation]
  );
  const handleTest = useCallback(
    (sub: WebhookSubscription) => testMutation.mutate(sub.id),
    [testMutation]
  );
  const handleDelete = useCallback(
    (sub: WebhookSubscription) => deleteMutation.mutate(sub.id),
    [deleteMutation]
  );

  const toggleEvent = useCallback((event: string, checked: boolean) => {
    setEvents((prev) => (checked ? [...prev, event] : prev.filter((e) => e !== event)));
  }, []);

  const handleCopy = useCallback(async () => {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret);
      setCopied(true);
    } catch {
      toast({ title: "Could not copy the secret", variant: "destructive" });
    }
  }, [createdSecret, toast]);

  const canSave = name.trim() !== "" && url.trim() !== "" && events.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <Webhook className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Outbound Webhooks</CardTitle>
          </div>
          <Button size="sm" className="min-h-11 sm:min-h-9" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add webhook
          </Button>
        </div>
        <CardDescription>
          Send signed JSON events to your own automation (n8n, Home Assistant, scripts). Each
          request carries an <code>X-Questarr-Signature</code> header: an HMAC-SHA256 of{" "}
          <code>timestamp.body</code> with the webhook secret. Failed deliveries are retried up to
          three times.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {subscriptions.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="webhooks-empty">
            No webhooks yet.
          </p>
        ) : (
          subscriptions.map((sub) => (
            <WebhookRow
              key={sub.id}
              sub={sub}
              onToggle={handleToggle}
              onTest={handleTest}
              onDelete={handleDelete}
              testing={testingIds.has(sub.id)}
            />
          ))
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add webhook</DialogTitle>
            <DialogDescription>
              Questarr will POST the selected events to this URL. The signing secret is generated
              for you and shown once.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="webhook-name">Name</Label>
              <Input
                id="webhook-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="n8n"
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhook-url">URL</Label>
              <Input
                id="webhook-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://automation.example.com/hooks/questarr"
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Events</legend>
              {availableEvents.map((event) => (
                <div key={event} className="flex min-h-11 items-center gap-2 sm:min-h-0">
                  <Checkbox
                    id={`webhook-event-${event}`}
                    checked={events.includes(event)}
                    onCheckedChange={(checked) => toggleEvent(event, checked === true)}
                  />
                  <Label htmlFor={`webhook-event-${event}`}>{EVENT_LABELS[event] ?? event}</Label>
                </div>
              ))}
            </fieldset>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!canSave || createMutation.isPending}
            >
              {createMutation.isPending ? "Saving…" : "Add webhook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createdSecret !== null}
        onOpenChange={(open) => !open && setCreatedSecret(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Webhook created</DialogTitle>
            <DialogDescription>
              Copy the signing secret now. It is not shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={createdSecret ?? ""}
              aria-label="Webhook signing secret"
              className="font-mono"
            />
            <Button variant="outline" onClick={handleCopy} aria-label="Copy signing secret">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreatedSecret(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
