import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { routePaths } from "@/lib/routes";
import {
  SETUP_WIZARD_STATE_KEY,
  useSetupWizardState,
} from "@/components/setup-wizard/use-wizard-status";

/**
 * A slim strip offering the setup wizard until it has been finished or dismissed. Installs that
 * predate the wizard see it once, so a long-time user is pointed at the settings added since
 * without having to hunt for them.
 */
export default function SetupWizardPrompt() {
  const [location, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { data } = useSetupWizardState();
  const dismiss = useMutation({
    mutationFn: async () =>
      (await apiRequest("PUT", SETUP_WIZARD_STATE_KEY[0]!, { state: "done" })).json(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: SETUP_WIZARD_STATE_KEY }),
  });

  if (!data || data.state === "done" || location === routePaths.setupWizard) return null;

  return (
    <div
      role="region"
      aria-label="Setup wizard"
      className="flex items-center gap-3 border-b bg-primary/10 px-4 py-2 text-sm"
    >
      <Wand2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        {data.state === "pending"
          ? "Finish setting up Questarr with a few questions."
          : "Questarr has new settings. Answer a few questions and only see the ones that matter to you."}
      </p>
      <Button size="sm" onClick={() => navigate(routePaths.setupWizard)}>
        Open wizard
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Dismiss setup wizard prompt"
        onClick={() => dismiss.mutate()}
        disabled={dismiss.isPending}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
