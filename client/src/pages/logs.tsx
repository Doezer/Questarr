import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLogStream } from "@/hooks/use-log-stream";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollText, Copy, Trash2, PauseCircle, PlayCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ────────────────────────────────────────────────────────────────────

interface ParsedLogLine {
  raw: string;
  // Pino numeric levels: 10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal
  level: number;
  levelLabel: string;
  levelClass: string;
  time: string;
  module?: string;
  msg: string;
  id: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const LEVEL_MAP: Record<number, { label: string; className: string }> = {
  10: { label: "TRACE", className: "bg-zinc-700 text-zinc-300" },
  20: { label: "DEBUG", className: "bg-zinc-600 text-zinc-200" },
  30: { label: "INFO", className: "bg-blue-600 text-blue-100" },
  40: { label: "WARN", className: "bg-yellow-600 text-yellow-100" },
  50: { label: "ERROR", className: "bg-red-600 text-red-100" },
  60: { label: "FATAL", className: "bg-red-900 text-red-100" },
};

const MAX_LINES = 2000;

// ── Helpers ──────────────────────────────────────────────────────────────────

let lineCounter = 0;
// Prefix with module-load timestamp so HMR resets don't produce duplicate React keys
const counterPrefix = Date.now();

function parseLogLine(raw: string): ParsedLogLine | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const level = typeof obj.level === "number" ? obj.level : 30;
    const levelInfo = LEVEL_MAP[level] ?? {
      label: String(level),
      className: "bg-zinc-500 text-white",
    };
    return {
      raw,
      level,
      levelLabel: levelInfo.label,
      levelClass: levelInfo.className,
      time: typeof obj.time === "string" ? obj.time : "",
      module: typeof obj.module === "string" ? obj.module : undefined,
      msg: typeof obj.msg === "string" ? obj.msg : raw,
      id: `log-${counterPrefix}-${++lineCounter}`,
    };
  } catch {
    return null;
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

const LogLineRow = memo(function LogLineRow({ line }: Readonly<{ line: ParsedLogLine }>) {
  const timeStr = line.time ? new Date(line.time).toLocaleTimeString() : "";

  return (
    <div className="flex items-start gap-2 py-0.5 hover:bg-white/5 rounded px-1 min-w-0">
      <span className="text-zinc-500 w-20 flex-shrink-0 text-right tabular-nums">{timeStr}</span>
      <span
        className={`text-xs font-bold px-1.5 rounded flex-shrink-0 w-12 text-center leading-5 ${line.levelClass}`}
      >
        {line.levelLabel}
      </span>
      {line.module && (
        <span className="text-zinc-400 w-24 flex-shrink-0 truncate">{line.module}</span>
      )}
      <span className="text-zinc-100 break-all min-w-0">{line.msg}</span>
    </div>
  );
});

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<ParsedLogLine[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [filterModule, setFilterModule] = useState<string>("all");

  // ── Initial load ──────────────────────────────────────────────────────────

  const { data: initialData, isLoading } = useQuery<{ lines: string[] }>({
    queryKey: ["/api/logs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/logs?limit=200");
      return res.json();
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!initialData?.lines) return;
    const parsed = initialData.lines
      .map((raw) => parseLogLine(raw))
      .filter((l): l is ParsedLogLine => l !== null);
    setLines(parsed);
  }, [initialData]);

  // ── Real-time stream ──────────────────────────────────────────────────────

  const handleNewLine = useCallback((raw: string) => {
    const parsed = parseLogLine(raw);
    if (!parsed) return;
    setLines((prev) => {
      const next = [...prev, parsed];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  useLogStream(handleNewLine);

  // ── Auto-scroll ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  // ── Derived data ──────────────────────────────────────────────────────────

  const modules = useMemo(() => {
    const set = new Set(lines.map((l) => l.module).filter((m): m is string => Boolean(m)));
    return Array.from(set).sort();
  }, [lines]);

  const minLevel = filterLevel === "all" ? 0 : parseInt(filterLevel, 10);

  const filteredLines = useMemo(
    () =>
      lines.filter((l) => {
        if (l.level < minLevel) return false;
        if (filterModule !== "all" && l.module !== filterModule) return false;
        return true;
      }),
    [lines, minLevel, filterModule]
  );

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleCopy = () => {
    const text = filteredLines.map((l) => l.raw).join("\n");
    navigator.clipboard
      .writeText(text)
      .then(() => {
        toast({
          title: "Copied",
          description: `${filteredLines.length} log lines copied to clipboard`,
        });
      })
      .catch(() => {
        toast({
          title: "Copy failed",
          description: "Clipboard access denied",
          variant: "destructive",
        });
      });
  };

  const handleClear = () => setLines([]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (!atBottom) setAutoScroll(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col p-6 gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ScrollText className="w-6 h-6" />
            Server Logs
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Real-time server output &mdash; {filteredLines.length} lines displayed
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoScroll((v) => !v)}
            aria-label={autoScroll ? "Pause auto-scroll" : "Resume auto-scroll"}
          >
            {autoScroll ? (
              <>
                <PauseCircle className="w-4 h-4 mr-1" />
                Pause
              </>
            ) : (
              <>
                <PlayCircle className="w-4 h-4 mr-1" />
                Resume
              </>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopy} aria-label="Copy log lines">
            <Copy className="w-4 h-4 mr-1" />
            Copy
          </Button>
          <Button variant="outline" size="sm" onClick={handleClear} aria-label="Clear log lines">
            <Trash2 className="w-4 h-4 mr-1" />
            Clear
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <Select value={filterLevel} onValueChange={setFilterLevel}>
          <SelectTrigger className="w-36" aria-label="Filter by log level">
            <SelectValue placeholder="Level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="10">Trace+</SelectItem>
            <SelectItem value="20">Debug+</SelectItem>
            <SelectItem value="30">Info+</SelectItem>
            <SelectItem value="40">Warn+</SelectItem>
            <SelectItem value="50">Error+</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterModule} onValueChange={setFilterModule}>
          <SelectTrigger className="w-40" aria-label="Filter by module">
            <SelectValue placeholder="Module" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All modules</SelectItem>
            {modules.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Log terminal */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto rounded-lg border border-border bg-zinc-950 font-mono text-xs p-3 space-y-0.5"
          onScroll={handleScroll}
          role="log"
          aria-label="Server log output"
          aria-live="polite"
        >
          {filteredLines.length === 0 && (
            <p className="text-zinc-500 text-center pt-8">No log lines to display.</p>
          )}
          {filteredLines.map((line) => (
            <LogLineRow key={line.id} line={line} />
          ))}
        </div>
      )}
    </div>
  );
}
