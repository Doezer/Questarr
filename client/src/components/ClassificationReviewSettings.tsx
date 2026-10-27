import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Cloud, Download, HelpCircle, ListChecks, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { apiFetch, apiRequest, throwIfResNotOk } from "@/lib/queryClient";
import type { CandidateReason, CandidateSignals } from "@shared/release-labels";

interface Candidate {
  id: string;
  releaseName: string;
  gameTitle: string | null;
  reasons: CandidateReason[];
  signals: CandidateSignals | null;
  priority: number;
  seenCount: number;
  suggestion: { label: string; confidence: number | null; model: string | null } | null;
}

interface CandidatesResponse {
  collecting: boolean;
  cloudSuggest: boolean;
  cloudAvailable: boolean;
  labels: string[];
  counts: Record<"pending" | "verified" | "ambiguous" | "rejected", number>;
  candidates: Candidate[];
}

const QUERY_KEY = ["/api/classification-candidates"];

const REASON_LABEL: Record<CandidateReason, string> = {
  unresolved: "Unresolved",
  low_confidence: "Low confidence",
  disagreement: "Rules and model disagree",
};

const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? "n/a" : `${Math.round(value * 100)}%`;

/** The label a reviewer most likely wants: the cloud suggestion, else the local model's guess. */
function proposedLabel(candidate: Candidate): string | undefined {
  if (candidate.suggestion) return candidate.suggestion.label;
  const guess = candidate.signals?.local?.class;
  return guess && guess !== "unknown" ? guess : undefined;
}

function CandidateRow({
  candidate,
  labels,
  cloudSuggest,
  cloudAvailable,
  busy,
  onReview,
  onSuggest,
}: Readonly<{
  candidate: Candidate;
  labels: string[];
  cloudSuggest: boolean;
  cloudAvailable: boolean;
  busy: boolean;
  onReview: (id: string, body: Record<string, string>) => void;
  onSuggest: (id: string) => void;
}>) {
  const [label, setLabel] = useState<string | undefined>(proposedLabel(candidate));
  const { signals, suggestion } = candidate;
  const selectId = `candidate-label-${candidate.id}`;

  return (
    <li className="space-y-3 rounded-md border p-3" data-testid={`candidate-${candidate.id}`}>
      <div className="space-y-1">
        <p className="break-all font-mono text-sm">{candidate.releaseName}</p>
        <p className="text-xs text-muted-foreground">
          {candidate.gameTitle ? `Searched for: ${candidate.gameTitle}` : "No game title"}
          {candidate.seenCount > 1 ? ` · seen ${candidate.seenCount} times` : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {candidate.reasons.map((reason) => (
          <Badge key={reason} variant="outline">
            {REASON_LABEL[reason]}
          </Badge>
        ))}
      </div>
      {signals && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
          <div>
            <dt className="inline font-medium">Rules: </dt>
            <dd className="inline">{signals.rules.class}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Local model: </dt>
            <dd className="inline">
              {signals.local
                ? `${signals.local.class} (${percent(signals.local.confidence)})`
                : "not installed"}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Pipeline: </dt>
            <dd className="inline">
              {signals.final.class} ({signals.final.source})
            </dd>
          </div>
        </dl>
      )}
      {suggestion && (
        <p className="text-xs">
          <span className="font-medium">Cloud suggestion, not verified: </span>
          {suggestion.label} ({percent(suggestion.confidence)}
          {suggestion.model ? `, ${suggestion.model}` : ""})
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <label htmlFor={selectId} className="sr-only">
          Label for {candidate.releaseName}
        </label>
        <Select value={label ?? ""} onValueChange={setLabel}>
          <SelectTrigger id={selectId} className="min-h-11 sm:w-44">
            <SelectValue placeholder="Pick a label" />
          </SelectTrigger>
          <SelectContent>
            {labels.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="min-h-11"
          disabled={!label || busy}
          onClick={() => label && onReview(candidate.id, { action: "correct", label })}
        >
          <Check className="mr-1 h-4 w-4" />
          Verify label
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-h-11"
          disabled={busy}
          onClick={() => onReview(candidate.id, { action: "ambiguous" })}
        >
          <HelpCircle className="mr-1 h-4 w-4" />
          Ambiguous
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-h-11"
          disabled={busy}
          onClick={() => onReview(candidate.id, { action: "reject" })}
        >
          <X className="mr-1 h-4 w-4" />
          Not an example
        </Button>
        {cloudSuggest && cloudAvailable && !suggestion && (
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11"
            disabled={busy}
            onClick={() => onSuggest(candidate.id)}
          >
            <Cloud className="mr-1 h-4 w-4" />
            Ask the cloud model
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Review queue for active learning (docs/RELEASE_CLASSIFICATION.md). Shown only while
 * collection is on or candidates exist, so nothing changes for installs that never enable it.
 */
export default function ClassificationReviewSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data } = useQuery<CandidatesResponse>({ queryKey: QUERY_KEY });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const onError = (error: Error) =>
    toast({ title: "Request failed", description: error.message, variant: "destructive" });

  const review = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, string> }) =>
      apiRequest("POST", `/api/classification-candidates/${id}/review`, body),
    onSuccess: refresh,
    onError,
  });
  const suggest = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/classification-candidates/${id}/suggest`),
    onSuccess: refresh,
    onError,
  });
  const clear = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/classification-candidates"),
    onSuccess: () => {
      setConfirmDelete(false);
      toast({ title: "Candidates deleted" });
      void refresh();
    },
    onError,
  });

  const exportVerified = async () => {
    try {
      const res = await apiFetch("/api/classification-candidates/export");
      await throwIfResNotOk(res);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "verified-candidates.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      onError(error as Error);
    }
  };

  if (!data?.counts) return null;
  const total = Object.values(data.counts).reduce((sum, n) => sum + n, 0);
  if (!data.collecting && total === 0) return null;

  const busy = review.isPending || suggest.isPending;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-3">
          <ListChecks className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Release classification review</CardTitle>
        </div>
        <CardDescription>
          Releases the classifier was unsure about, most useful first. Only labels you verify can be
          exported as training examples; suggestions and predictions never count. Nothing is
          retrained automatically.
          {!data.collecting && " Collection is off (ACTIVE_LEARNING_COLLECT)."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2" aria-label="Candidate counts">
          <Badge variant="secondary">{data.counts.pending} to review</Badge>
          <Badge variant="outline">{data.counts.verified} verified</Badge>
          <Badge variant="outline">{data.counts.ambiguous} ambiguous</Badge>
          <Badge variant="outline">{data.counts.rejected} not examples</Badge>
        </div>

        {data.candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing waiting for review.</p>
        ) : (
          <ul className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
            {data.candidates.map((candidate) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                labels={data.labels}
                cloudSuggest={data.cloudSuggest}
                cloudAvailable={data.cloudAvailable}
                busy={busy}
                onReview={(id, body) => review.mutate({ id, body })}
                onSuggest={(id) => suggest.mutate(id)}
              />
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={data.counts.verified === 0}
            onClick={exportVerified}
          >
            <Download className="mr-2 h-4 w-4" />
            Export verified ({data.counts.verified})
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={total === 0}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete all candidates
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all candidates?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every collected release, including the {data.counts.verified} you
              verified. Export them first if you want to keep them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => clear.mutate()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
