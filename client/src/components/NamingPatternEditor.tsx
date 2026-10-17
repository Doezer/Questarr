import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useDebounce } from "@/hooks/use-debounce";
import {
  NAMING_TOKENS,
  NAMING_TOKEN_HELP,
  renderNameOrFallback,
  validatePattern,
} from "@shared/naming";

interface NamingPatternEditorProps {
  value: string;
  onChange: (value: string) => void;
}

interface PreviewSample {
  title: string;
  leafName: string;
  fullPath: string;
}

const PRESETS = ["{Title}", "{Title} ({Year})", "{Title} ({Year}) [{Group}]", "{TitleThe}"];

const INSTANT_SAMPLE = {
  title: "The Example Quest",
  year: "2021-06-15",
  platform: "PC",
  version: "v1.2.3",
  group: "GROUP",
  source: "GOG",
  igdbId: 12345,
  steamAppId: 67890,
};

export function NamingPatternEditor({ value, onChange }: NamingPatternEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const validation = useMemo(() => validatePattern(value), [value]);
  const instant = useMemo(
    () => (validation.ok ? renderNameOrFallback(value, INSTANT_SAMPLE) : ""),
    [value, validation.ok]
  );
  const debounced = useDebounce(value, 300);
  const debouncedValid = useMemo(() => validatePattern(debounced).ok, [debounced]);

  const { data: preview, isFetching } = useQuery<{ samples: PreviewSample[] }>({
    queryKey: ["/api/imports/naming/preview", debounced],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/imports/naming/preview", { pattern: debounced });
      return res.json();
    },
    enabled: debouncedValid,
    staleTime: 30_000,
  });

  const insertToken = (token: string) => {
    const input = inputRef.current;
    const snippet = `{${token}}`;
    if (!input) {
      onChange(value + snippet);
      return;
    }
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + snippet + value.slice(end));
    const caret = start + snippet.length;
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="rename-pattern">Naming Pattern</Label>
        <Input
          id="rename-pattern"
          ref={inputRef}
          value={value}
          maxLength={200}
          aria-invalid={!validation.ok}
          aria-describedby="rename-pattern-help rename-pattern-errors"
          onChange={(e) => onChange(e.target.value)}
        />
        <p id="rename-pattern-help" className="text-xs text-muted-foreground">
          Names the game&apos;s folder (or its file, for single-file releases) inside the platform
          folder. Slashes are not allowed.
        </p>
        <div id="rename-pattern-errors" aria-live="polite">
          {validation.errors.map((message) => (
            <p key={message} className="text-xs text-destructive">
              {message}
            </p>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Insert a token">
        {NAMING_TOKENS.map((token) => (
          <Button
            key={token}
            type="button"
            variant="outline"
            size="sm"
            className="h-11 px-3 font-mono text-xs md:h-8"
            title={NAMING_TOKEN_HELP[token]}
            aria-label={`Insert {${token}}: ${NAMING_TOKEN_HELP[token]}`}
            onClick={() => insertToken(token)}
          >
            {`{${token}}`}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Presets">
        {PRESETS.map((preset) => (
          <Button
            key={preset}
            type="button"
            variant="secondary"
            size="sm"
            className="h-11 px-3 text-xs md:h-8"
            onClick={() => onChange(preset)}
          >
            {preset}
          </Button>
        ))}
      </div>

      <div className="rounded-md border bg-muted/30 p-3 space-y-2" aria-label="Preview">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Preview
        </p>
        {validation.ok ? (
          <p className="text-sm font-mono break-all" data-testid="naming-instant-preview">
            {instant}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Fix the pattern to see a preview.</p>
        )}
        {debouncedValid && preview?.samples && (
          <ul
            className={`space-y-1 ${isFetching ? "opacity-60" : ""}`}
            data-testid="naming-server-preview"
          >
            {preview.samples.map((sample) => (
              <li key={`${sample.title}-${sample.fullPath}`} className="text-xs">
                <span className="text-muted-foreground">{sample.title}</span>
                <span className="block font-mono break-all">{sample.fullPath}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
