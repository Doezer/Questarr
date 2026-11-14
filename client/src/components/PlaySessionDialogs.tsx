import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { formatMinutes } from "@/lib/play-time";
import type { GamePlaySession } from "@shared/schema";

const MINUTE_MS = 60_000;
const MAX_MINUTES = 24 * 60;

/** A date as `YYYY-MM-DDTHH:mm` in the viewer's local time, the `datetime-local` format. */
export function toLocalInput(value: string | Date): string {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The instant a `datetime-local` value stands for (local time), or `null` when it is empty. */
function fromLocalInput(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Why `start`..`end` is not a valid session, or `null`. Mirrors the server's limits. */
function timesProblem(start: Date | null, end: Date | null): string | null {
  if (!start || !end) return "Enter both times.";
  const minutes = (end.getTime() - start.getTime()) / MINUTE_MS;
  if (minutes < 1) return "The end must be at least a minute after the start.";
  if (minutes > MAX_MINUTES) return "A session cannot last more than 24 hours.";
  if (end.getTime() > Date.now() + 5 * MINUTE_MS) return "A session cannot end in the future.";
  return null;
}

interface EditDialogProps {
  session: GamePlaySession | null;
  pending: boolean;
  onClose: () => void;
  onSave: (session: GamePlaySession, startedAt: Date, endedAt: Date) => void;
}

/** Changes when a manual or timer session started and ended. */
export function EditSessionDialog({
  session,
  pending,
  onClose,
  onSave,
}: Readonly<EditDialogProps>) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    if (!session?.endedAt) return;
    setStart(toLocalInput(session.startedAt));
    setEnd(toLocalInput(session.endedAt));
  }, [session]);

  const startDate = fromLocalInput(start);
  const endDate = fromLocalInput(end);
  const problem = timesProblem(startDate, endDate);

  return (
    <Dialog open={session !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit session</DialogTitle>
          <DialogDescription>
            Change when you started and stopped. A session lasts up to 24 hours.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (session && startDate && endDate && !problem) onSave(session, startDate, endDate);
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="edit-session-start">Started</Label>
            <Input
              id="edit-session-start"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-session-end">Stopped</Label>
            <Input
              id="edit-session-end"
              type="datetime-local"
              value={end}
              max={toLocalInput(new Date())}
              onChange={(e) => setEnd(e.target.value)}
              className="h-11"
            />
          </div>
          <p
            className={`text-sm ${problem ? "text-destructive" : "text-muted-foreground"}`}
            role={problem ? "alert" : undefined}
          >
            {problem ??
              `Length: ${formatMinutes(((endDate?.getTime() ?? 0) - (startDate?.getTime() ?? 0)) / MINUTE_MS)}`}
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" className="h-11" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="h-11" disabled={Boolean(problem) || pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface SplitDialogProps {
  session: GamePlaySession | null;
  pending: boolean;
  onClose: () => void;
  onSplit: (session: GamePlaySession, splitAt: Date) => void;
}

/** Cuts a manual or timer session in two, e.g. a timer left running overnight. */
export function SplitSessionDialog({
  session,
  pending,
  onClose,
  onSplit,
}: Readonly<SplitDialogProps>) {
  const [cut, setCut] = useState("");

  useEffect(() => {
    if (!session?.endedAt) return;
    const middle =
      (new Date(session.startedAt).getTime() + new Date(session.endedAt).getTime()) / 2;
    setCut(toLocalInput(new Date(middle)));
  }, [session]);

  const cutDate = fromLocalInput(cut);
  const startMs = session ? new Date(session.startedAt).getTime() : 0;
  const endMs = session?.endedAt ? new Date(session.endedAt).getTime() : 0;
  let problem: string | null = null;
  if (!cutDate) problem = "Pick the time to cut at.";
  else if (cutDate.getTime() - startMs < MINUTE_MS || endMs - cutDate.getTime() < MINUTE_MS) {
    problem = "Each part must last at least a minute.";
  }

  return (
    <Dialog open={session !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Split session</DialogTitle>
          <DialogDescription>
            {session?.endedAt
              ? `This session ran from ${new Date(session.startedAt).toLocaleString()} to ${new Date(session.endedAt).toLocaleString()}. It becomes two sessions.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (session && cutDate && !problem) onSplit(session, cutDate);
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="split-session-at">Cut at</Label>
            <Input
              id="split-session-at"
              type="datetime-local"
              value={cut}
              onChange={(e) => setCut(e.target.value)}
              className="h-11"
            />
          </div>
          <p
            className={`text-sm ${problem ? "text-destructive" : "text-muted-foreground"}`}
            role={problem ? "alert" : undefined}
          >
            {problem ??
              `Parts: ${formatMinutes((cutDate!.getTime() - startMs) / MINUTE_MS)} and ${formatMinutes((endMs - cutDate!.getTime()) / MINUTE_MS)}`}
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" className="h-11" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="h-11" disabled={Boolean(problem) || pending}>
              Split
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
