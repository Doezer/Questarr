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
  initialPath?: string;
  title?: string;
  /** Override the server-side browse root (e.g. "/" to browse the full filesystem). Defaults to library root. */
  root?: string;
}

export function FileBrowser({
  open,
  onOpenChange,
  onSelect,
  initialPath = "/",
  title = "Select Directory",
  root,
}: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
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
        const data = await res.json();
        setData(data);
      } catch (err) {
        if (attemptFallback && root !== undefined) {
          // Fall back to browsing without the explicit root (uses library root)
          try {
            const fallbackUrl = `/api/system/browse?path=${encodeURIComponent(p)}`;
            const res = await apiRequest("GET", fallbackUrl);
            const data = await res.json();
            setData(data);
            return;
          } catch {
            // fallback also failed — fall through to error state
          }
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
    }
  }, [open, initialPath]);

  useEffect(() => {
    if (open) {
      loadPath(currentPath);
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
        {data?.items.map((item) => (
          <div
            key={item.path}
            role={item.isDirectory ? "button" : undefined}
            tabIndex={item.isDirectory ? 0 : undefined}
            className={`
                    flex items-center gap-2 p-2 rounded-sm cursor-pointer hover:bg-accent
                    ${!item.isDirectory ? "opacity-50 cursor-default" : ""}
                  `}
            onClick={() => item.isDirectory && handleNavigate(item.path)}
            onKeyDown={(e) => {
              if (item.isDirectory && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                handleNavigate(item.path);
              }
            }}
          >
            {item.isDirectory ? (
              <Folder className="h-4 w-4 text-blue-500" />
            ) : (
              <File className="h-4 w-4 text-gray-500" />
            )}
            <span className="text-sm flex-1 truncate">{item.name}</span>
            {item.isDirectory && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[500px] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Navigate and select a directory</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 p-2 bg-muted rounded-md mb-2">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          <div className="text-sm font-mono truncate flex-1" title={currentPath}>
            {currentPath}
          </div>
          <Button
            variant="ghost"
            size="sm"
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
              onSelect(currentPath);
              onOpenChange(false);
            }}
          >
            Select Current
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
