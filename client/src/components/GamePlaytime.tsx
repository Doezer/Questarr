import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Merge, Pencil, Plus, Scissors, Timer, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { EditSessionDialog, SplitSessionDialog } from "./PlaySessionDialogs";
import PlayTimerButton from "./PlayTimerButton";
import { formatMinutes, sessionLengthMinutes } from "@/lib/play-time";
import { isEditablePlaySession, type GamePlaySession } from "@shared/schema";
import { ApiError } from "@/lib/queryClient";

interface GamePlaytimeProps {
  gameId: string;
  gameTitle: string;
  /** IGDB "normally" estimate in hours, shown next to the total. */
  timeToBeatHours?: number | null;
}

const SESSIONS_SHOWN = 8;

/** Today's date as `YYYY-MM-DD` in the viewer's local time, for the date field. */
function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The start of a session played on `date` (local): noon, so it lands on the right day, moved
 * earlier when a long session from noon would end in the future (the server rejects that).
 */
function startOfPlayedDay(date: string, durationMinutes: number): string | undefined {
  if (date === localToday()) return undefined; // today: the server ends it just now
  const noon = new Date(`${date}T12:00:00`).getTime();
  const latestStart = Date.now() - durationMinutes * 60_000;
  return new Date(Math.min(noon, latestStart)).toISOString();
}

function formatWhen(value: string | Date): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Time spent in a game: a start/stop timer, hand-entered sessions, and the list of past
 * sessions with their total. Sessions are personal and never leave this server.
 */
export default function GamePlaytime({
  gameId,
  gameTitle,
  timeToBeatHours,
}: Readonly<GamePlaytimeProps>) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const queryKey = `/api/games/${gameId}/play-sessions`;

  const { data: sessions = [] } = useQuery<GamePlaySession[]>({ queryKey: [queryKey] });

  const finished = useMemo(() => sessions.filter((s) => s.endedAt), [sessions]);
  const totalMinutes = useMemo(
    () => finished.reduce((sum, s) => sum + sessionLengthMinutes(s.startedAt, s.endedAt), 0),
    [finished]
  );

  const [showAll, setShowAll] = useState(false);
  const [date, setDate] = useState(localToday);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [queryKey] });
    void queryClient.invalidateQueries({ queryKey: ["/api/stats/play-time"] });
  };

  const addSession = useMutation({
    mutationFn: async (body: { startedAt?: string | undefined; durationMinutes: number }) => {
      const res = await apiRequest("POST", `/api/games/${gameId}/play-sessions`, body);
      return res.json();
    },
    onSuccess: () => {
      refresh();
      setHours("");
      setMinutes("");
    },
    onError: () => toast({ description: "Failed to add the session", variant: "destructive" }),
  });

  const deleteSession = useMutation({
    mutationFn: async (sessionId: string) => {
      await apiRequest("DELETE", `/api/games/${gameId}/play-sessions/${sessionId}`);
    },
    onSuccess: refresh,
    onError: () => toast({ description: "Failed to delete the session", variant: "destructive" }),
  });

  const failure = (fallback: string) => (error: unknown) =>
    toast({
      description: error instanceof ApiError ? error.message : fallback,
      variant: "destructive",
    });

  const [editing, setEditing] = useState<GamePlaySession | null>(null);
  const [splitting, setSplitting] = useState<GamePlaySession | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const editSession = useMutation({
    mutationFn: async (v: { id: string; startedAt: Date; endedAt: Date }) => {
      await apiRequest("PATCH", `/api/games/${gameId}/play-sessions/${v.id}`, {
        startedAt: v.startedAt.toISOString(),
        endedAt: v.endedAt.toISOString(),
      });
    },
    onSuccess: () => {
      refresh();
      setEditing(null);
    },
    onError: failure("Failed to edit the session"),
  });

  const splitSession = useMutation({
    mutationFn: async (v: { id: string; splitAt: Date }) => {
      await apiRequest("POST", `/api/games/${gameId}/play-sessions/${v.id}/split`, {
        splitAt: v.splitAt.toISOString(),
      });
    },
    onSuccess: () => {
      refresh();
      setSplitting(null);
    },
    onError: failure("Failed to split the session"),
  });

  const mergeSessions = useMutation({
    mutationFn: async (sessionIds: string[]) => {
      await apiRequest("POST", `/api/games/${gameId}/play-sessions/merge`, { sessionIds });
    },
    onSuccess: () => {
      refresh();
      setSelected([]);
    },
    onError: failure("Failed to merge the sessions"),
  });

  // A selection only holds sessions that still exist (one may have been deleted or merged).
  const selectedIds = useMemo(
    () => selected.filter((id) => finished.some((s) => s.id === id)),
    [selected, finished]
  );
  const toggleSelected = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );

  const duration =
    (Number.parseInt(hours || "0", 10) || 0) * 60 + (Number.parseInt(minutes || "0", 10) || 0);
  const canAdd = duration >= 1 && duration <= 24 * 60 && date !== "";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canAdd) return;
    addSession.mutate({ startedAt: startOfPlayedDay(date, duration), durationMinutes: duration });
  };

  const visible = showAll ? finished : finished.slice(0, SESSIONS_SHOWN);

  return (
    <div className="space-y-5" data-testid="section-playtime">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold tabular-nums" data-testid="text-playtime-total">
            {formatMinutes(totalMinutes)}
          </p>
          <p className="text-sm text-muted-foreground">
            {finished.length} session{finished.length === 1 ? "" : "s"}
            {timeToBeatHours ? ` · about ${timeToBeatHours}h to beat (IGDB)` : ""}
          </p>
        </div>
        <div className="w-full sm:w-48">
          <PlayTimerButton gameId={gameId} gameTitle={gameTitle} variant="full" />
        </div>
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-3" aria-label="Add a session">
        <div className="space-y-1">
          <Label htmlFor={`play-date-${gameId}`}>Played on</Label>
          <Input
            id={`play-date-${gameId}`}
            type="date"
            value={date}
            max={localToday()}
            onChange={(e) => setDate(e.target.value)}
            className="h-10 w-40"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`play-hours-${gameId}`}>Hours</Label>
          <Input
            id={`play-hours-${gameId}`}
            type="number"
            inputMode="numeric"
            min={0}
            max={24}
            placeholder="0"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="h-10 w-20"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`play-minutes-${gameId}`}>Minutes</Label>
          <Input
            id={`play-minutes-${gameId}`}
            type="number"
            inputMode="numeric"
            min={0}
            max={59}
            placeholder="0"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="h-10 w-20"
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          className="h-10 gap-2"
          disabled={!canAdd || addSession.isPending}
        >
          <Plus className="h-4 w-4" />
          Add session
        </Button>
      </form>

      {finished.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Timer className="h-4 w-4" />
          No sessions yet. Start the timer or add the time you played.
        </p>
      ) : (
        <ul
          className="divide-y divide-border rounded-md border border-border"
          aria-label="Sessions"
        >
          {visible.map((session) => {
            const editable = isEditablePlaySession(session);
            const label = `${formatMinutes(
              sessionLengthMinutes(session.startedAt, session.endedAt)
            )} session of ${formatWhen(session.startedAt)}`;
            return (
              <li key={session.id} className="flex items-center gap-1 px-3 py-1">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center">
                  {editable && (
                    <Checkbox
                      checked={selectedIds.includes(session.id)}
                      onCheckedChange={() => toggleSelected(session.id)}
                      aria-label={`Select the ${label} to merge`}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium tabular-nums">
                    {formatMinutes(sessionLengthMinutes(session.startedAt, session.endedAt))}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatWhen(session.startedAt)}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="shrink-0 text-[10px] capitalize"
                  title={
                    session.source === "steam"
                      ? "Estimated from the growth of your Steam play time between two syncs"
                      : undefined
                  }
                >
                  {session.source === "steam" ? "Steam · estimated" : session.source}
                </Badge>
                {editable && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 shrink-0 text-muted-foreground"
                      onClick={() => setEditing(session)}
                      aria-label={`Edit the ${label}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 shrink-0 text-muted-foreground"
                      onClick={() => setSplitting(session)}
                      aria-label={`Split the ${label}`}
                    >
                      <Scissors className="h-4 w-4" />
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteSession.mutate(session.id)}
                  disabled={deleteSession.isPending}
                  aria-label={`Delete the ${label}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {selectedIds.length >= 2 && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2"
          role="status"
        >
          <span className="text-sm">{selectedIds.length} sessions selected</span>
          <Button
            type="button"
            size="sm"
            className="h-10 gap-2"
            onClick={() => mergeSessions.mutate(selectedIds)}
            disabled={mergeSessions.isPending}
          >
            <Merge className="h-4 w-4" />
            Merge sessions
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10"
            onClick={() => setSelected([])}
          >
            Clear
          </Button>
        </div>
      )}
      <EditSessionDialog
        session={editing}
        pending={editSession.isPending}
        onClose={() => setEditing(null)}
        onSave={(session, startedAt, endedAt) =>
          editSession.mutate({ id: session.id, startedAt, endedAt })
        }
      />
      <SplitSessionDialog
        session={splitting}
        pending={splitSession.isPending}
        onClose={() => setSplitting(null)}
        onSplit={(session, splitAt) => splitSession.mutate({ id: session.id, splitAt })}
      />
      {finished.length > SESSIONS_SHOWN && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${finished.length} sessions`}
        </Button>
      )}
    </div>
  );
}
