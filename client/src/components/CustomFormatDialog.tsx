import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  validateFormatSpec,
  type CustomFormat,
  type FormatField,
  type FormatMatchMode,
  type FormatSpec,
} from "@shared/release-scoring";

export type CustomFormatDraft = Omit<CustomFormat, "id">;

const FIELD_LABELS: Record<FormatField, string> = {
  title: "Release name",
  group: "Release group",
  uploader: "Uploader",
  category: "Category",
  protocol: "Protocol",
  indexer: "Indexer",
};

const MODE_LABELS: Record<FormatMatchMode, string> = {
  contains: "contains",
  exact: "is exactly",
  regex: "matches regex",
};

const EMPTY_SPEC: FormatSpec = { field: "group", mode: "exact", value: "" };

interface CustomFormatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The format being edited, or null to create one. */
  format: CustomFormat | null;
  saving: boolean;
  onSave: (draft: CustomFormatDraft) => void;
}

/** Create/edit dialog for one custom format: name, score and its list of conditions. */
export default function CustomFormatDialog({
  open,
  onOpenChange,
  format,
  saving,
  onSave,
}: Readonly<CustomFormatDialogProps>) {
  const [name, setName] = useState("");
  const [score, setScore] = useState("0");
  const [hardReject, setHardReject] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [specs, setSpecs] = useState<FormatSpec[]>([EMPTY_SPEC]);

  useEffect(() => {
    if (!open) return;
    setName(format?.name ?? "");
    setScore(String(format?.score ?? 0));
    setHardReject(format?.hardReject ?? false);
    setEnabled(format?.enabled ?? true);
    setSpecs(format?.specs.length ? format.specs : [EMPTY_SPEC]);
  }, [open, format]);

  const updateSpec = (index: number, patch: Partial<FormatSpec>) =>
    setSpecs((current) => current.map((spec, i) => (i === index ? { ...spec, ...patch } : spec)));

  const specProblems = specs.map((spec) => validateFormatSpec(spec));
  const scoreValue = Number.parseInt(score, 10);
  const valid =
    name.trim().length > 0 &&
    Number.isInteger(scoreValue) &&
    specs.length > 0 &&
    specProblems.every((problem) => problem === null);

  const submit = () => {
    if (!valid) return;
    onSave({
      name: name.trim(),
      score: scoreValue,
      hardReject,
      enabled,
      specs: specs.map((spec) => ({ ...spec, value: spec.value.trim() })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{format ? "Edit custom format" : "New custom format"}</DialogTitle>
          <DialogDescription>
            A release matches when every condition field is satisfied. Conditions on the same field
            are alternatives, unless marked required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <div className="space-y-1.5">
              <Label htmlFor="cf-name">Name</Label>
              <Input
                id="cf-name"
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Trusted groups"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-score">Score</Label>
              <Input
                id="cf-score"
                type="number"
                inputMode="numeric"
                value={score}
                onChange={(event) => setScore(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3">
            <Label>Conditions</Label>
            {specs.map((spec, index) => (
              <div key={index} className="space-y-2 rounded-md border p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                  <Select
                    value={spec.field}
                    onValueChange={(value) => updateSpec(index, { field: value as FormatField })}
                  >
                    <SelectTrigger aria-label={`Condition ${index + 1} field`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(FIELD_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={spec.mode}
                    onValueChange={(value) => updateSpec(index, { mode: value as FormatMatchMode })}
                  >
                    <SelectTrigger aria-label={`Condition ${index + 1} match mode`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(MODE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`Condition ${index + 1} value`}
                    value={spec.value}
                    maxLength={200}
                    onChange={(event) => updateSpec(index, { value: event.target.value })}
                    placeholder={spec.mode === "regex" ? "^(CODEX|FLT)$" : "Value"}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    aria-label={`Remove condition ${index + 1}`}
                    disabled={specs.length === 1}
                    onClick={() => setSpecs((current) => current.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {spec.value.trim() !== "" && specProblems[index] && (
                  <p className="text-xs text-destructive">{specProblems[index]}</p>
                )}
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`cf-negate-${index}`}
                      checked={spec.negate === true}
                      onCheckedChange={(checked) => updateSpec(index, { negate: checked === true })}
                    />
                    <Label htmlFor={`cf-negate-${index}`} className="font-normal">
                      Negate (does not match)
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`cf-required-${index}`}
                      checked={spec.required === true}
                      onCheckedChange={(checked) =>
                        updateSpec(index, { required: checked === true })
                      }
                    />
                    <Label htmlFor={`cf-required-${index}`} className="font-normal">
                      Required
                    </Label>
                  </div>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={specs.length >= 20}
              onClick={() => setSpecs((current) => [...current, EMPTY_SPEC])}
            >
              <Plus className="mr-1 h-4 w-4" /> Add condition
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <Label htmlFor="cf-hard-reject">Reject matching releases</Label>
              <p className="text-xs text-muted-foreground">
                The release is rejected whatever its score.
              </p>
            </div>
            <Switch id="cf-hard-reject" checked={hardReject} onCheckedChange={setHardReject} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <Label htmlFor="cf-enabled">Enabled</Label>
            <Switch id="cf-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!valid || saving}>
            {saving ? "Saving..." : "Save format"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
