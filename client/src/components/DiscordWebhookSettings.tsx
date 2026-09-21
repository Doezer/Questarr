import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings2, Eye, EyeOff, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

/**
 * Discord webhook configuration, scoped to the Stats page where it's the only
 * consumer (sharing library stats to a Discord channel). Kept as a local,
 * page-adjacent setting rather than a global Settings tab entry.
 *
 * The webhook URL is a secret: the API never returns the real value once
 * configured (just `configured: true`), so the input is left blank rather
 * than pre-filled — same pattern as the IGDB client secret field.
 */
export default function DiscordWebhookSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [showWebhook, setShowWebhook] = useState(false);

  const { data: discordSettings } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/settings/discord"],
    queryFn: () => apiRequest("GET", "/api/settings/discord").then((r) => r.json()),
  });

  const updateDiscordMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/settings/discord", { webhookUrl: url });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/discord"] });
      setWebhookUrl("");
      toast({ title: "Discord webhook saved" });
    },
    onError: () => {
      toast({ title: "Failed to save Discord webhook", variant: "destructive" });
    },
  });

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setWebhookUrl(e.target.value);
  }, []);

  const handleToggleShow = useCallback(() => {
    setShowWebhook((v) => !v);
  }, []);

  const handleSave = useCallback(() => {
    updateDiscordMutation.mutate(webhookUrl.trim());
  }, [updateDiscordMutation, webhookUrl]);

  // Allow saving an empty value to clear an existing webhook, but not when
  // there's nothing configured and nothing typed.
  const saveDisabled =
    updateDiscordMutation.isPending || (!webhookUrl.trim() && !discordSettings?.configured);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Configure Discord webhook">
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Webhook className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Discord Webhook</span>
            </div>
            {discordSettings?.configured ? (
              <Badge
                variant="default"
                className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
              >
                Configured
              </Badge>
            ) : (
              <Badge variant="outline">Not configured</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Set a webhook URL to enable one-click sharing of your library stats to a Discord
            channel.
          </p>
          <div className="space-y-2">
            <Label htmlFor="stats-discord-webhook">Webhook URL</Label>
            <div className="relative">
              <Input
                id="stats-discord-webhook"
                type={showWebhook ? "text" : "password"}
                placeholder={
                  discordSettings?.configured
                    ? "Enter a new URL to replace, or clear to remove"
                    : "https://discord.com/api/webhooks/..."
                }
                value={webhookUrl}
                onChange={handleChange}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={showWebhook ? "Hide webhook URL" : "Show webhook URL"}
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={handleToggleShow}
              >
                {showWebhook ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Create a webhook in your Discord server under Channel Settings → Integrations.
            </p>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={handleSave} disabled={saveDisabled}>
              {updateDiscordMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
