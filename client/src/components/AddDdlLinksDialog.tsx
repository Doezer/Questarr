import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Link2, Loader2, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { extractHosterLinks } from "@shared/ddl-links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Game } from "@shared/schema";

interface LinkCheck {
  link: string;
  supported: boolean;
  host?: string;
  filename?: string;
  filesize?: number;
  error?: string;
}

interface AddDdlLinksDialogProps {
  game: Pick<Game, "id" | "title">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Links to start with (e.g. the ones a feed item carried). */
  initialLinks?: string[];
}

const formatSize = (bytes?: number) =>
  bytes === undefined ? "" : `${(bytes / 1024 / 1024).toFixed(bytes > 1024 ** 3 ? 0 : 1)} MB`;

/** Reads a File as base64 (the API takes the container file inside its JSON body). */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export default function AddDdlLinksDialog({
  game,
  open,
  onOpenChange,
  initialLinks,
}: AddDdlLinksDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => initialLinks?.join("\n") ?? "");
  const [password, setPassword] = useState("");
  const [container, setContainer] = useState<File | null>(null);
  const [checks, setChecks] = useState<LinkCheck[] | null>(null);

  const pastedCount = useMemo(() => extractHosterLinks(text).length, [text]);
  const hasInput = pastedCount > 0 || container !== null;

  const buildBody = async () => ({
    links: text,
    ...(container ? { containerBase64: await toBase64(container) } : {}),
    ...(password ? { archivePassword: password } : {}),
  });

  const checkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/games/${game.id}/ddl/check`, await buildBody());
      return (await res.json()) as { links: LinkCheck[] };
    },
    onSuccess: (data) => setChecks(data.links),
    onError: (error: Error) =>
      toast({
        title: "Could not check the links",
        description: error.message,
        variant: "destructive",
      }),
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/games/${game.id}/ddl/links`, await buildBody());
      return (await res.json()) as { links: number };
    },
    onSuccess: (data) => {
      toast({
        title: "Links sent to Real-Debrid",
        description: `${data.links} link${data.links === 1 ? "" : "s"} are being downloaded.`,
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      setText("");
      setPassword("");
      setContainer(null);
      setChecks(null);
      onOpenChange(false);
    },
    onError: (error: Error) =>
      toast({
        title: "Could not send the links",
        description: error.message,
        variant: "destructive",
      }),
  });

  const busy = checkMutation.isPending || sendMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add download links</DialogTitle>
          <DialogDescription>
            Paste the file-hoster links for {game.title}, or attach a DLC container. Real-Debrid
            fetches them, then Questarr imports the files.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ddl-links">Links</Label>
            <Textarea
              id="ddl-links"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setChecks(null);
              }}
              rows={6}
              placeholder="One link per line, or paste a whole post"
              className="font-mono text-xs"
              data-testid="input-ddl-links"
            />
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {pastedCount} link{pastedCount === 1 ? "" : "s"} found
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ddl-container">Link container (DLC, CCF, RSDF)</Label>
            <div className="flex items-center gap-2">
              <input
                ref={fileInput}
                id="ddl-container"
                type="file"
                accept=".dlc,.ccf,.rsdf"
                className="sr-only"
                onChange={(event) => {
                  setContainer(event.target.files?.[0] ?? null);
                  setChecks(null);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 sm:h-9"
                onClick={() => fileInput.current?.click()}
              >
                Choose file
              </Button>
              <span className="truncate text-sm text-muted-foreground">
                {container?.name ?? "No file selected"}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ddl-password">Archive password (optional)</Label>
            <Input
              id="ddl-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
              data-testid="input-ddl-password"
            />
          </div>

          {checks && (
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
              {checks.map((check) => (
                <li key={check.link} className="flex items-start gap-2">
                  {check.supported ? (
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"
                      aria-label="OK"
                    />
                  ) : (
                    <XCircle
                      className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                      aria-label="Problem"
                    />
                  )}
                  <span className="min-w-0 break-all">
                    {check.filename ?? check.link}
                    {check.filesize ? ` (${formatSize(check.filesize)})` : ""}
                    {check.error ? (
                      <span className="text-destructive"> - {check.error}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            className="h-10 sm:h-9"
            disabled={!hasInput || busy}
            onClick={() => checkMutation.mutate()}
            data-testid="button-ddl-check"
          >
            {checkMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Check links
          </Button>
          <Button
            type="button"
            className="h-10 gap-2 sm:h-9"
            disabled={!hasInput || busy}
            onClick={() => sendMutation.mutate()}
            data-testid="button-ddl-send"
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            Send to Real-Debrid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
