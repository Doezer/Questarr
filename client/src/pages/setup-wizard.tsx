import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SettingRow } from "@/components/ui/setting-row";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  DEFAULT_WIZARD_ANSWERS,
  inferWizardAnswers,
  visibleWizardSteps,
  type WizardAnswers,
  type WizardConfigured,
  type WizardStepDef,
} from "@shared/setup-wizard";
import { ConfiguredBadge, QuestionsStep, STEP_RENDERERS } from "@/components/setup-wizard/steps";
import {
  SETUP_WIZARD_STATE_KEY,
  useSetupWizardState,
  useWizardStatus,
} from "@/components/setup-wizard/use-wizard-status";

/** Steps that have a screen in this build (a service whose adapter is missing is not offered). */
function hasScreen(step: WizardStepDef): boolean {
  return step.id === "questions" || step.id === "summary" || step.id in STEP_RENDERERS;
}

export default function SetupWizardPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const wizardState = useSetupWizardState();
  const status = useWizardStatus();

  const [answers, setAnswers] = useState<WizardAnswers>(DEFAULT_WIZARD_ANSWERS);
  const [onlyUnconfigured, setOnlyUnconfigured] = useState(false);
  const [index, setIndex] = useState(0);
  // What was configured when the wizard opened: used to decide which steps to show, so a step
  // does not vanish under the user's feet the moment they save it.
  const [snapshot, setSnapshot] = useState<WizardConfigured | null>(null);
  const initialised = useRef(false);

  const loaded = !status.isLoading && wizardState.data !== undefined;
  useEffect(() => {
    if (initialised.current || !loaded) return;
    initialised.current = true;
    const fresh = wizardState.data?.state === "pending";
    setSnapshot(status.configured);
    // An install that predates the wizard starts from what it already uses, and is shown only
    // what it has not configured yet. A brand-new install walks through everything.
    if (!fresh) {
      setAnswers(inferWizardAnswers(status.configured));
      setOnlyUnconfigured(true);
    }
  }, [loaded, status.configured, wizardState.data?.state]);

  const steps = useMemo(
    () => visibleWizardSteps(answers, snapshot ?? {}, onlyUnconfigured).filter(hasScreen),
    [answers, snapshot, onlyUnconfigured]
  );
  const safeIndex = Math.min(index, steps.length - 1);
  const step = steps[safeIndex];

  const finish = useMutation({
    mutationFn: async () =>
      (await apiRequest("PUT", SETUP_WIZARD_STATE_KEY[0]!, { state: "done" })).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SETUP_WIZARD_STATE_KEY });
      navigate("/");
    },
    onError: (error: Error) =>
      toast({ title: "Could not finish", description: error.message, variant: "destructive" }),
  });

  // The summary reads configuration saved by cards that do not report back to the wizard
  // (platforms, RetroAchievements, import), so read it again when the summary opens.
  const refreshStatus = status.refresh;
  const onSummary = step?.id === "summary";
  useEffect(() => {
    if (onSummary) refreshStatus();
  }, [onSummary, refreshStatus]);

  if (!loaded || !step) {
    return (
      <div className="p-6 text-sm text-muted-foreground" role="status">
        Loading…
      </div>
    );
  }

  const isLast = safeIndex === steps.length - 1;
  const render = STEP_RENDERERS[step.id];
  const isFresh = wizardState.data?.state === "pending";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl space-y-6 p-4 md:p-6">
        <header className="space-y-3">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" aria-hidden="true" />
            <h1 className="text-xl font-semibold">Setup wizard</h1>
          </div>
          <p className="text-sm text-muted-foreground" data-testid="wizard-progress-label">
            Step {safeIndex + 1} of {steps.length}
          </p>
          <Progress
            value={((safeIndex + 1) / steps.length) * 100}
            aria-label="Setup wizard progress"
          />
        </header>

        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-lg">
              {step.title}
            </CardTitle>
            <CardDescription>{step.summary}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {step.id === "questions" && (
              <>
                <QuestionsStep
                  answers={answers}
                  onChange={(next) => {
                    setAnswers(next);
                  }}
                />
                {!isFresh && (
                  <SettingRow
                    id="wizard-only-unconfigured"
                    label="Only show what is not configured yet"
                    description="Skips services that are already set up. Turn off to review everything."
                    checked={onlyUnconfigured}
                    onCheckedChange={setOnlyUnconfigured}
                  />
                )}
              </>
            )}
            {step.id === "summary" && <SummaryList steps={steps} configured={status.configured} />}
            {render && render({ answers, status })}
          </CardContent>
        </Card>

        <nav aria-label="Wizard navigation" className="flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() => setIndex(Math.max(0, safeIndex - 1))}
            disabled={safeIndex === 0}
            className="gap-1"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            {!isLast && (
              <Button variant="ghost" onClick={() => finish.mutate()} disabled={finish.isPending}>
                Skip wizard
              </Button>
            )}
            {isLast ? (
              <Button onClick={() => finish.mutate()} disabled={finish.isPending} className="gap-1">
                <Check className="h-4 w-4" aria-hidden="true" />
                Finish
              </Button>
            ) : (
              <Button onClick={() => setIndex(safeIndex + 1)} className="gap-1">
                {step.id === "questions" ? "Start" : "Next"}
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </nav>
      </div>
    </div>
  );
}

function SummaryList({
  steps,
  configured,
}: Readonly<{ steps: WizardStepDef[]; configured: WizardConfigured }>) {
  const rows = steps.filter((s) => s.id !== "questions" && s.id !== "summary");
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        You can come back to this wizard any time from Settings &gt; General, and every setting
        stays available in Settings.
      </p>
      <ul className="divide-y rounded-md border">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 p-3">
            <span className="text-sm font-medium">{row.title}</span>
            {row.id in configured ? (
              <ConfiguredBadge configured={Boolean(configured[row.id])} />
            ) : (
              <span className="text-xs text-muted-foreground">Visited</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
