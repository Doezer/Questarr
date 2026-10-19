import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Scale, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
import TagListEditor from "@/components/TagListEditor";
import CustomFormatDialog, { type CustomFormatDraft } from "@/components/CustomFormatDialog";
import ReleaseScoreBadge, { formatPoints } from "@/components/ReleaseScoreBadge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  compileCustomFormats,
  evaluateRelease,
  type BuiltInOverride,
  type CustomFormat,
  type ProtocolPreference,
  type ReleaseProfile,
} from "@shared/release-scoring";

interface BuiltInRuleInfo {
  id: string;
  label: string;
  points: number;
  locked: boolean;
  rejects: boolean;
}

interface ReleaseScoringResponse {
  profile: ReleaseProfile | null;
  formats: CustomFormat[];
  builtInRules: BuiltInRuleInfo[];
}

const QUERY_KEY = ["/api/release-scoring"];

/** Release profile, built-in rule weights and custom formats (replaces preferred groups). */
export default function ReleaseScoringSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data } = useQuery<ReleaseScoringResponse>({ queryKey: QUERY_KEY });

  const [minScore, setMinScore] = useState("0");
  const [protocol, setProtocol] = useState<ProtocolPreference>("either");
  const [requiredTerms, setRequiredTerms] = useState<string[]>([]);
  const [ignoredTerms, setIgnoredTerms] = useState<string[]>([]);
  const [maxSizeGb, setMaxSizeGb] = useState("");
  const [overrides, setOverrides] = useState<Record<string, BuiltInOverride>>({});
  const [editing, setEditing] = useState<CustomFormat | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<CustomFormat | null>(null);
  const [testName, setTestName] = useState("");
  const [testGame, setTestGame] = useState("");

  // format mutations refetch the same query; only reset the form when the saved profile changed
  const syncedProfile = useRef<string | null>(null);

  useEffect(() => {
    const profile = data?.profile;
    if (!profile) return;
    const snapshot = JSON.stringify(profile);
    if (snapshot === syncedProfile.current) return;
    syncedProfile.current = snapshot;
    setMinScore(String(profile.minScore));
    setProtocol(profile.protocolPreference);
    setRequiredTerms(profile.requiredTerms);
    setIgnoredTerms(profile.ignoredTerms);
    // full precision, so saving an unrelated change never rewrites the stored limit
    setMaxSizeGb(profile.maxSizeBytes == null ? "" : String(profile.maxSizeBytes / 1e9));
    setOverrides(profile.builtInOverrides as Record<string, BuiltInOverride>);
  }, [data?.profile]);

  const onError = (error: Error) =>
    toast({ title: "Save failed", description: error.message, variant: "destructive" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const saveProfile = useMutation({
    mutationFn: async () => {
      if (!data?.profile) throw new Error("Profile not loaded");
      const maxGb = Number.parseFloat(maxSizeGb);
      const body: ReleaseProfile = {
        ...data.profile,
        minScore: Number.parseInt(minScore, 10) || 0,
        protocolPreference: protocol,
        requiredTerms,
        ignoredTerms,
        maxSizeBytes: Number.isFinite(maxGb) && maxGb > 0 ? Math.round(maxGb * 1e9) : null,
        builtInOverrides: overrides,
      };
      return (await apiRequest("PUT", "/api/release-profile", body)).json();
    },
    onSuccess: () => {
      toast({ title: "Release profile saved" });
      refresh();
    },
    onError,
  });

  const saveFormat = useMutation({
    mutationFn: async (draft: CustomFormatDraft) =>
      (
        await (editing
          ? apiRequest("PATCH", `/api/custom-formats/${editing.id}`, draft)
          : apiRequest("POST", "/api/custom-formats", draft))
      ).json(),
    onSuccess: () => {
      setDialogOpen(false);
      toast({ title: "Custom format saved" });
      refresh();
    },
    onError,
  });

  const toggleFormat = useMutation({
    mutationFn: async (format: CustomFormat) =>
      (
        await apiRequest("PATCH", `/api/custom-formats/${format.id}`, { enabled: !format.enabled })
      ).json(),
    onSuccess: refresh,
    onError,
  });

  const deleteFormat = useMutation({
    mutationFn: async (format: CustomFormat) => {
      await apiRequest("DELETE", `/api/custom-formats/${format.id}`);
    },
    onSuccess: () => {
      setDeleting(null);
      toast({ title: "Custom format deleted" });
      refresh();
    },
    onError,
  });

  const setOverride = (id: string, patch: BuiltInOverride) =>
    setOverrides((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

  const testEvaluation = useMemo(() => {
    if (!data?.profile || !testName.trim() || !testGame.trim()) return null;
    // the profile as shown in the form, saved or not
    const maxGb = Number.parseFloat(maxSizeGb);
    return evaluateRelease(
      { title: testName.trim(), downloadType: "torrent", seeders: 10 },
      { gameTitle: testGame.trim() },
      {
        ...data.profile,
        minScore: Number.parseInt(minScore, 10) || 0,
        protocolPreference: protocol,
        requiredTerms,
        ignoredTerms,
        maxSizeBytes: Number.isFinite(maxGb) && maxGb > 0 ? Math.round(maxGb * 1e9) : null,
        builtInOverrides: overrides,
      },
      compileCustomFormats(data.formats)
    );
  }, [
    data,
    minScore,
    protocol,
    requiredTerms,
    ignoredTerms,
    maxSizeGb,
    overrides,
    testName,
    testGame,
  ]);

  const formats = data?.formats ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5" />
          Release Scoring
        </CardTitle>
        <CardDescription>
          Every search result gets a score. Auto-search takes accepted releases with the best score;
          the manual search shows the score and why a release was rejected.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <section aria-labelledby="scoring-profile" className="space-y-4">
          <h3 id="scoring-profile" className="font-semibold">
            Release profile
          </h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="scoring-min-score">Minimum score</Label>
              <Input
                id="scoring-min-score"
                type="number"
                inputMode="numeric"
                value={minScore}
                onChange={(event) => setMinScore(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scoring-protocol">Preferred protocol</Label>
              <Select
                value={protocol}
                onValueChange={(value) => setProtocol(value as ProtocolPreference)}
              >
                <SelectTrigger id="scoring-protocol">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="either">Either</SelectItem>
                  <SelectItem value="torrent">Torrent</SelectItem>
                  <SelectItem value="usenet">Usenet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scoring-max-size">Maximum size (GB)</Label>
              <Input
                id="scoring-max-size"
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="No limit"
                value={maxSizeGb}
                onChange={(event) => setMaxSizeGb(event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TagListEditor
              tags={requiredTerms}
              onChange={setRequiredTerms}
              inputId="scoring-required-terms"
              label="Required terms (at least one)"
              placeholder="e.g. GOG, /repack/"
              helperText="Words, or /regex/. A release must contain one of them."
              emptyText="No required terms."
              addAriaLabel="Add required term"
              removeAriaLabel={(tag) => `Remove required term ${tag}`}
            />
            <TagListEditor
              tags={ignoredTerms}
              onChange={setIgnoredTerms}
              inputId="scoring-ignored-terms"
              label="Ignored terms"
              placeholder="e.g. demo, /beta/"
              helperText="Words, or /regex/. A release containing one is rejected."
              emptyText="No ignored terms."
              addAriaLabel="Add ignored term"
              removeAriaLabel={(tag) => `Remove ignored term ${tag}`}
            />
          </div>
        </section>

        <section aria-labelledby="scoring-formats" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 id="scoring-formats" className="font-semibold">
              Custom formats
            </h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Add format
            </Button>
          </div>
          {formats.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No custom formats. Add one to prefer or reject a release group, an uploader or a
              wording.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {formats.map((format) => (
                <li key={format.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-[10rem] flex-1">
                    <p className="break-words font-medium">{format.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {format.specs.length} condition{format.specs.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  {format.hardReject && <Badge variant="destructive">Rejects</Badge>}
                  <Badge variant="outline" className="font-mono">
                    {formatPoints(data?.profile?.formatScores[format.id] ?? format.score)}
                  </Badge>
                  <Switch
                    checked={format.enabled}
                    onCheckedChange={() => toggleFormat.mutate(format)}
                    aria-label={`Enable ${format.name}`}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit ${format.name}`}
                    onClick={() => {
                      setEditing(format);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete ${format.name}`}
                    onClick={() => setDeleting(format)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="scoring-builtin" className="space-y-3">
          <h3 id="scoring-builtin" className="font-semibold">
            Built-in rules
          </h3>
          <ul className="divide-y rounded-md border">
            {(data?.builtInRules ?? []).map((rule) => {
              const override = overrides[rule.id];
              return (
                <li key={rule.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{rule.label}</p>
                    {rule.rejects && <p className="text-xs text-muted-foreground">Also rejects</p>}
                  </div>
                  <Input
                    type="number"
                    inputMode="numeric"
                    className="w-24"
                    aria-label={`${rule.label} points`}
                    value={override?.points ?? rule.points}
                    onChange={(event) => {
                      const points = Number.parseInt(event.target.value, 10);
                      if (Number.isFinite(points)) setOverride(rule.id, { points });
                    }}
                  />
                  <Switch
                    checked={override?.enabled !== false}
                    disabled={rule.locked}
                    onCheckedChange={(enabled) => setOverride(rule.id, { enabled })}
                    aria-label={`Enable ${rule.label}`}
                  />
                </li>
              );
            })}
          </ul>
        </section>

        <div className="flex justify-end">
          <Button
            onClick={() => saveProfile.mutate()}
            disabled={!data?.profile || saveProfile.isPending}
          >
            {saveProfile.isPending ? "Saving..." : "Save profile and rules"}
          </Button>
        </div>

        <section aria-labelledby="scoring-test" className="space-y-3 border-t pt-6">
          <h3 id="scoring-test" className="font-semibold">
            Test a release name
          </h3>
          <p className="text-sm text-muted-foreground">
            Uses the saved formats and the weights above, without saving them.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="scoring-test-game">Game title</Label>
              <Input
                id="scoring-test-game"
                value={testGame}
                onChange={(event) => setTestGame(event.target.value)}
                placeholder="Dishonored"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scoring-test-name">Release name</Label>
              <Input
                id="scoring-test-name"
                value={testName}
                onChange={(event) => setTestName(event.target.value)}
                placeholder="Dishonored.Definitive.Edition-CODEX"
              />
            </div>
          </div>
          {testEvaluation && <ReleaseScoreBadge evaluation={testEvaluation} />}
        </section>
      </CardContent>

      <CustomFormatDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        format={editing}
        saving={saveFormat.isPending}
        onSave={(draft) => saveFormat.mutate(draft)}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this custom format?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name} will stop affecting new searches.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && deleteFormat.mutate(deleting)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
