import React, { useState, useEffect, useCallback } from "react";
import { Folder, File, ChevronRight, CornerLeftUp, Loader2, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";

interface FileStats {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

interface BrowseResponse {
  path: string;
  parent: string;
  items: FileStats[];
}

interface FileBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
  onMultiSelect?: (paths: string[]) => void;
  initialPath?: string;
  title?: string;
  /** Override the server-side browse root (e.g. "/" to browse the full filesystem). Defaults to library root. */
  root?: string;
  /** Select an individual file instead of the current directory. */
  mode?: "file" | "folder";
  /** Allow selecting several files from the current directory. */
  multiple?: boolean;
  /** Quick-navigation locations shown above the path bar. */
  shortcuts?: Array<{ label: string; path: string }>;
}

export function FileBrowser({
  open,
  onOpenChange,
  onSelect,
  initialPath = "/",
  title = "Select Directory",
  root,
  mode = "folder",
  multiple = false,
  onMultiSelect,
  shortcuts,
}: Readonly<FileBrowserProps>) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(() => new Set());
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadPath = useCallback(
    async (p: string, attemptFallback: boolean = true) => {
      setLoading(true);
      setError(null);
      try {
        const url =
          root !== undefined
            ? `/api/system/browse?path=${encodeURIComponent(p)}&root=${encodeURIComponent(root)}`
            : `/api/system/browse?path=${encodeURIComponent(p)}`;
        const res = await apiRequest("GET", url);
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const data = await res.json();
        setData(data);
      } catch {
        if (attemptFallback && root !== undefined) {
          // Fall back to browsing without the explicit root (uses library root)
          try {
            const fallbackUrl = `/api/system/browse?path=${encodeURIComponent(p)}`;
            const res = await apiRequest("GET", fallbackUrl);
            if (!res.ok) throw new Error(`Server error: ${res.status}`);
            const data = await res.json();
            setData(data);
            return;
          } catch (e) {
            console.debug("[FileBrowser] Fallback browse failed:", e);
          }
        }
        // Path doesn't exist on this machine; reset to root rather than showing an error
        if (attemptFallback && p !== "/") {
          setCurrentPath("/");
          return;
        }
        setError("Failed to load directory");
      } finally {
        setLoading(false);
      }
    },
    [root]
  );

  useEffect(() => {
    if (open) {
      setCurrentPath(initialPath);
      setSelectedFile(null);
      setSelectedFiles(new Set());
    }
  }, [open, initialPath]);

  useEffect(() => {
    if (open) {
      loadPath(currentPath);
      setSelectedFile(null);
      setSelectedFiles(new Set());
    }
  }, [open, currentPath, loadPath]);

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
  };

  const handleUp = () => {
    if (data?.parent) {
      setCurrentPath(data.parent);
    }
  };

  let scrollContent: React.ReactNode;
  if (loading) {
    scrollContent = (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  } else if (error) {
    scrollContent = (
      <div className="flex items-center justify-center h-40 text-destructive">{error}</div>
    );
  } else {
    scrollContent = (
      <div className="p-1 space-y-1">
        {data?.items.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-4">Empty directory</div>
        )}
        {data?.items.map((item) =>
          item.isDirectory ? (
            <button
              key={item.path}
              type="button"
              className="flex items-center gap-2 p-2 rounded-sm cursor-pointer hover:bg-accent w-full text-left"
              onClick={() => handleNavigate(item.path)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleNavigate(item.path);
                }
              }}
            >
              <Folder className="h-4 w-4 text-blue-500" />
              <span className="text-sm flex-1 truncate">{item.name}</span>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            </button>
          ) : multiple ? (
            <label
              key={item.path}
              className="flex w-full cursor-pointer items-center gap-2 rounded-sm p-2 text-left hover:bg-accent"
            >
              <input
                type="checkbox"
                aria-label={`Select ${item.name}`}
                checked={selectedFiles.has(item.path)}
                onChange={() => {
                  setSelectedFiles((current) => {
                    const next = new Set(current);
                    if (next.has(item.path)) next.delete(item.path);
                    else next.add(item.path);
                    return next;
                  });
                }}
                className="h-4 w-4"
              />
              <File className="h-4 w-4 text-gray-500" />
              <span className="flex-1 truncate text-sm">{item.name}</span>
            </label>
          ) : (
            <button
              type="button"
              key={item.path}
              className={`flex items-center gap-2 p-2 rounded-sm w-full text-left ${
                mode === "file" ? "cursor-pointer hover:bg-accent" : "opacity-50 cursor-default"
              }`}
              onClick={() => {
                if (mode === "file") setSelectedFile(item.path);
              }}
              disabled={mode !== "file"}
            >
              <File className="h-4 w-4 text-gray-500" />
              <span className="text-sm flex-1 truncate">{item.name}</span>
              {mode === "file" && selectedFile === item.path && (
                <span className="text-xs font-semibold text-primary">Selected</span>
              )}
            </button>
          )
        )}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[500px] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <div className="flex items-center justify-between gap-2">
            <DialogDescription className="m-0">
              {multiple
                ? "Navigate and select files"
                : mode === "file"
                  ? "Navigate and select a file"
                  : "Navigate and select a directory"}
            </DialogDescription>
            {shortcuts && shortcuts.length > 0 && (
              <div className="flex items-center gap-1.5">
                {shortcuts.map((shortcut) => (
                  <Button
                    key={shortcut.path}
                    variant="outline"
                    size="sm"
                    disabled={currentPath === shortcut.path}
                    onClick={() => setCurrentPath(shortcut.path)}
                    title={shortcut.path}
                    className="h-7 text-xs"
                  >
                    {shortcut.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="flex items-center gap-2 p-2 bg-muted rounded-md mb-2">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          <div className="text-sm font-mono truncate flex-1" title={currentPath}>
            {currentPath}
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Navigate up"
            disabled={!data?.parent || currentPath === "/"}
            onClick={handleUp}
          >
            <CornerLeftUp className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1 border rounded-md">{scrollContent}</ScrollArea>

        <div className="flex justify-end pt-4 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (loading || !data || error) return;
              if (mode === "file" && !multiple) {
                if (!selectedFile) return;
                onSelect(selectedFile);
              } else {
                onSelect(currentPath);
              }
              onOpenChange(false);
            }}
            disabled={
              loading || !data || !!error || (mode === "file" && !multiple && !selectedFile)
            }
          >
            {mode === "file" && !multiple ? "Select File" : "Select Current"}
          </Button>
          {multiple && onMultiSelect && (
            <Button
              disabled={loading || !data || !!error || selectedFiles.size === 0}
              onClick={() => {
                if (loading || !data || error || selectedFiles.size === 0) return;
                onMultiSelect(Array.from(selectedFiles));
                onOpenChange(false);
              }}
            >
              Select {selectedFiles.size} File{selectedFiles.size === 1 ? "" : "s"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
