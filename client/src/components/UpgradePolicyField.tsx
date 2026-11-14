import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { type UpgradePolicy } from "@shared/schema";

/** Select value standing for "no override": follow the account default. */
const FOLLOW_DEFAULT = "default";

export const UPGRADE_POLICY_LABELS: Record<UpgradePolicy, string> = {
  notify: "Notify me",
  off: "Off",
};

interface UpgradePolicyFieldProps {
  readonly gameId: string;
  /** The game's own override, or null when it follows the account default. */
  readonly upgradePolicy: UpgradePolicy | null;
  readonly defaultPolicy: UpgradePolicy;
}

export default function UpgradePolicyField({
  gameId,
  upgradePolicy,
  defaultPolicy,
}: UpgradePolicyFieldProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation<void, Error, UpgradePolicy | null>({
    mutationFn: async (value) => {
      await apiRequest("PATCH", `/api/games/${gameId}/upgrade-policy`, { upgradePolicy: value });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/games"] }),
    onError: () =>
      toast({ description: "Failed to save the upgrade policy", variant: "destructive" }),
  });

  return (
    <div data-testid="section-upgrade-policy">
      <label htmlFor="upgrade-policy" className="font-semibold mb-2 flex items-center gap-2">
        <ArrowUpCircle className="w-4 h-4" />
        Updates
      </label>
      <Select
        value={upgradePolicy ?? FOLLOW_DEFAULT}
        disabled={mutation.isPending}
        onValueChange={(value) =>
          mutation.mutate(value === FOLLOW_DEFAULT ? null : (value as UpgradePolicy))
        }
      >
        <SelectTrigger id="upgrade-policy" className="h-10 w-full max-w-sm sm:h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={FOLLOW_DEFAULT}>
            Account default ({UPGRADE_POLICY_LABELS[defaultPolicy]})
          </SelectItem>
          <SelectItem value="notify">{UPGRADE_POLICY_LABELS.notify}</SelectItem>
          <SelectItem value="off">{UPGRADE_POLICY_LABELS.off}</SelectItem>
        </SelectContent>
      </Select>
      <p className="mt-1 text-xs text-muted-foreground">
        Notify: look for newer versions and repacks and flag them. Off: don&apos;t search for
        updates or packs for this game.
      </p>
    </div>
  );
}
