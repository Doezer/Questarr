import React, { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Upload, X } from "lucide-react";
import { apiFetch, apiRequest, throwIfResNotOk } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { withBasePath } from "@/lib/app-path";

interface GameScreenshotWithUrl {
  id: string;
  filePath: string;
  caption: string | null;
  createdAt: string | null;
  url: string;
}

/** Share owner-scoped personal media between the gallery and the game section counts. */
export function useGameScreenshots(gameId: string, enabled = true) {
  return useQuery<GameScreenshotWithUrl[]>({
    queryKey: [`/api/games/${gameId}/screenshots`],
    enabled,
  });
}

/** Personal media stored through the existing authenticated screenshot API. */
export default function GameScreenshotGallery({
  gameId,
  title = "Your screenshots",
}: Readonly<{ gameId: string; title?: string }>) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const screenshotsQuery = useGameScreenshots(gameId);
  const screenshots = screenshotsQuery.data ?? [];
  /** Refresh this game after a write, close completed actions, and report sanitized failures. */
  const invalidateOnSuccess = (queryKey: string, errorMessage: string, extra?: () => void) => ({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      extra?.();
    },
    onError: () => toast({ description: errorMessage, variant: "destructive" as const }),
  });
  // ─── Screenshots ─────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightboxScreenshot, setLightboxScreenshot] = useState<GameScreenshotWithUrl | null>(null);

  const uploadScreenshotMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiFetch(`/api/games/${gameId}/screenshots`, {
        method: "POST",
        body: formData,
      });
      await throwIfResNotOk(res);
      return res.json();
    },
    ...invalidateOnSuccess(`/api/games/${gameId}/screenshots`, "Failed to upload screenshot"),
  });

  const deleteScreenshotMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/games/${gameId}/screenshots/${id}`);
    },
    ...invalidateOnSuccess(`/api/games/${gameId}/screenshots`, "Failed to delete screenshot", () =>
      setLightboxScreenshot(null)
    ),
  });

  /** Clear the input before uploading so the same file can be chosen again after a failure. */
  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) uploadScreenshotMutation.mutate(file);
  };

  /** Render each fetch state explicitly so failed requests never look like an empty gallery. */
  function renderScreenshots() {
    if (screenshotsQuery.isPending) {
      return <output className="block text-sm text-muted-foreground">Loading screenshots…</output>;
    }
    if (screenshotsQuery.isError) {
      return (
        <div role="alert" className="text-sm space-y-2">
          <p>Could not load your screenshots.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void screenshotsQuery.refetch()}
            disabled={screenshotsQuery.isFetching}
          >
            Retry
          </Button>
        </div>
      );
    }
    if (screenshots.length === 0) {
      return <p className="text-sm text-muted-foreground">No screenshots yet.</p>;
    }
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {screenshots.map((screenshot, index) => (
          <button
            key={screenshot.id}
            type="button"
            className="relative aspect-video rounded-md overflow-hidden border border-border"
            onClick={() => setLightboxScreenshot(screenshot)}
            aria-label={`View screenshot ${index + 1}`}
          >
            <img
              src={withBasePath(screenshot.url)}
              alt={screenshot.caption ?? "Game screenshot"}
              loading="lazy"
              className="w-full h-full object-cover"
            />
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      <section aria-label={title}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold flex items-center gap-2">
            <ImagePlus className="w-4 h-4" />
            {title}
          </h3>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadScreenshotMutation.isPending}
          >
            {uploadScreenshotMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            Upload
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileSelected}
            aria-label="Upload screenshot"
          />
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          JPEG, PNG or WebP · up to 8 MB per image · stored on your server.
        </p>
        {renderScreenshots()}
      </section>
      <Dialog
        open={!!lightboxScreenshot}
        onOpenChange={(open) => !open && setLightboxScreenshot(null)}
      >
        <DialogContent
          className="max-w-3xl max-h-[90dvh] overflow-y-auto p-2"
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">Screenshot</DialogTitle>
          {lightboxScreenshot && (
            <div className="space-y-2">
              <img
                src={withBasePath(lightboxScreenshot.url)}
                alt={lightboxScreenshot.caption ?? "Game screenshot"}
                className="w-full max-h-[70dvh] rounded-md object-contain"
              />
              <div className="flex justify-end px-1 pb-1">
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => deleteScreenshotMutation.mutate(lightboxScreenshot.id)}
                  disabled={deleteScreenshotMutation.isPending}
                >
                  <X className="w-3.5 h-3.5" />
                  Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
