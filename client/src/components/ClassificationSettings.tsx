import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Sparkles } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type Mode = "hybrid" | "local" | "cloud";

interface Values {
  mode: Mode;
  localThreshold: number;
  holdUnknown: boolean;
  collect: boolean;
  cloudSuggest: boolean;
  lowConfidence: number;
  maxCandidates: number;
}

interface SettingsResponse {
  settings: Values;
  /** setting name -> the environment variable that fixes it */
  locked: Partial<Record<keyof Values, string>>;
  localModel: { installed: boolean; version: string | null; path: string };
  cloud: { configured: boolean; model: string };
}

export const CLASSIFICATION_SETTINGS_KEY = ["/api/settings/classification"];

const MODES: { value: Mode; label: string; help: string }[] = [
  {
    value: "hybrid",
    label: "Hybrid (recommended)",
    help: "Rules, then the local model. The cloud model is asked only when those cannot decide.",
  },
  {
    value: "local",
    label: "Local only",
    help: "Rules and the local model. Nothing is ever sent to a cloud provider.",
  },
  {
    value: "cloud",
    label: "Cloud only (legacy)",
    help: "The previous behaviour: the TypeSafe/Jev check alone. Needs a TypeSafe key.",
  },
];

const toPercent = (value: number) => String(Math.round(value * 100));

/** "" while typing; null when the text is not a whole number in range. */
function parseWhole(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

function LockedNote({ name }: Readonly<{ name: string | undefined }>) {
  if (!name) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Fixed by the <code>{name}</code> environment variable. Unset it to change this here.
    </p>
  );
}

/**
 * Release classification settings (docs/RELEASE_CLASSIFICATION.md): the classifier mode and
 * thresholds, and the active-learning options. An environment variable still wins over a saved
 * value, so a setting it fixes is shown read-only.
 */
export default function ClassificationSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data } = useQuery<SettingsResponse>({ queryKey: CLASSIFICATION_SETTINGS_KEY });

  const [mode, setMode] = useState<Mode>("hybrid");
  const [threshold, setThreshold] = useState("70");
  const [holdUnknown, setHoldUnknown] = useState(false);
  const [collect, setCollect] = useState(false);
  const [cloudSuggest, setCloudSuggest] = useState(false);
  const [lowConfidence, setLowConfidence] = useState("85");
  const [maxCandidates, setMaxCandidates] = useState("5000");

  const settings = data?.settings;
  useEffect(() => {
    if (!settings) return;
    setMode(settings.mode);
    setThreshold(toPercent(settings.localThreshold));
    setHoldUnknown(settings.holdUnknown);
    setCollect(settings.collect);
    setCloudSuggest(settings.cloudSuggest);
    setLowConfidence(toPercent(settings.lowConfidence));
    setMaxCandidates(String(settings.maxCandidates));
  }, [settings]);

  const save = useMutation({
    mutationFn: (body: Partial<Values>) => apiRequest("PUT", "/api/settings/classification", body),
    onSuccess: () => {
      toast({ title: "Classification settings saved" });
      void queryClient.invalidateQueries({ queryKey: CLASSIFICATION_SETTINGS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["/api/classification-candidates"] });
    },
    onError: (error: Error) =>
      toast({ title: "Could not save", description: error.message, variant: "destructive" }),
  });

  if (!data?.settings || !data.localModel || !data.cloud) return null;
  const { locked, localModel, cloud } = data;

  const thresholdValue = parseWhole(threshold, 1, 100);
  const lowConfidenceValue = parseWhole(lowConfidence, 1, 100);
  const maxValue = parseWhole(maxCandidates, 100, 50000);
  const valid = thresholdValue !== null && lowConfidenceValue !== null && maxValue !== null;

  const onSave = () => {
    if (!valid) return;
    // Only send what can change: a setting fixed by an environment variable would be refused
    const all: Values = {
      mode,
      localThreshold: thresholdValue / 100,
      holdUnknown,
      collect,
      cloudSuggest,
      lowConfidence: lowConfidenceValue / 100,
      maxCandidates: maxValue,
    };
    const body = Object.fromEntries(
      Object.entries(all).filter(([key]) => !(key in locked))
    ) as Partial<Values>;
    save.mutate(body);
  };

  const modeHelp = MODES.find((item) => item.value === mode)?.help;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-3">
          <Sparkles className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Release classification</CardTitle>
        </div>
        <CardDescription>
          Decides whether a release is the game itself or a patch, DLC, crack, demo or soundtrack
          before an unattended download.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap gap-2" aria-label="Classifier status">
          <Badge variant={localModel.installed ? "secondary" : "outline"}>
            {localModel.installed
              ? `Local model installed${localModel.version ? ` (${localModel.version})` : ""}`
              : "Local model not installed"}
          </Badge>
          <Badge variant={cloud.configured ? "secondary" : "outline"}>
            {cloud.configured ? `Cloud provider: ${cloud.model}` : "No cloud provider configured"}
          </Badge>
        </div>

        <div className="space-y-2">
          <Label htmlFor="classification-mode">Classification type</Label>
          <Select
            value={mode}
            onValueChange={(value) => setMode(value as Mode)}
            disabled={!!locked.mode}
          >
            <SelectTrigger id="classification-mode" className="min-h-11 sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{modeHelp}</p>
          <LockedNote name={locked.mode} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="classification-threshold">Local model confidence (%)</Label>
            <Input
              id="classification-threshold"
              inputMode="numeric"
              className="min-h-11"
              value={threshold}
              disabled={!!locked.localThreshold}
              aria-invalid={thresholdValue === null}
              onChange={(e) => setThreshold(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Below this the local model abstains and the next layer decides (1 to 100, default 70).
            </p>
            <LockedNote name={locked.localThreshold} />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div className="space-y-1">
              <Label htmlFor="classification-hold-unknown">Hold unclassifiable releases</Label>
              <p className="text-xs text-muted-foreground">
                Keep releases no layer could classify for review instead of downloading them.
              </p>
              <LockedNote name={locked.holdUnknown} />
            </div>
            <Switch
              id="classification-hold-unknown"
              checked={holdUnknown}
              disabled={!!locked.holdUnknown}
              onCheckedChange={setHoldUnknown}
            />
          </div>
        </div>

        <fieldset className="space-y-4 rounded-md border p-4">
          <legend className="px-1 text-sm font-medium">Active learning</legend>
          <p className="text-xs text-muted-foreground">
            Off by default. Keeps the releases the classifier was unsure about so you can label
            them. Nothing is retrained automatically.
          </p>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="classification-collect">Collect uncertain releases</Label>
              <LockedNote name={locked.collect} />
            </div>
            <Switch
              id="classification-collect"
              checked={collect}
              disabled={!!locked.collect}
              onCheckedChange={setCollect}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="classification-cloud-suggest">Allow cloud suggestions</Label>
              <p className="text-xs text-muted-foreground">
                Adds an &quot;Ask the cloud model&quot; button per release. Each press is one paid
                call, and a suggestion is never a verified label.
                {!cloud.configured && " Needs a TypeSafe key."}
              </p>
              <LockedNote name={locked.cloudSuggest} />
            </div>
            <Switch
              id="classification-cloud-suggest"
              checked={cloudSuggest}
              disabled={!!locked.cloudSuggest}
              onCheckedChange={setCloudSuggest}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="classification-low-confidence">Low-confidence below (%)</Label>
              <Input
                id="classification-low-confidence"
                inputMode="numeric"
                className="min-h-11"
                value={lowConfidence}
                aria-invalid={lowConfidenceValue === null}
                onChange={(e) => setLowConfidence(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                A decided release under this confidence is collected (1 to 100, default 85).
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="classification-max-candidates">Maximum candidates kept</Label>
              <Input
                id="classification-max-candidates"
                inputMode="numeric"
                className="min-h-11"
                value={maxCandidates}
                aria-invalid={maxValue === null}
                onChange={(e) => setMaxCandidates(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Collection stops here until you delete some (100 to 50,000, default 5,000).
              </p>
            </div>
          </div>
        </fieldset>

        <Button className="min-h-11" disabled={!valid || save.isPending} onClick={onSave}>
          <Save className="mr-2 h-4 w-4" />
          Save classification settings
        </Button>
      </CardContent>
    </Card>
  );
}
