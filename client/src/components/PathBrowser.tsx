import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Folder, File, ArrowUp, Loader2, HardDrive } from "lucide-react";

interface PathBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  title?: string;
  extensions?: string[]; // Optional filter for file extensions
}

export function PathBrowser({
  isOpen,
  onClose,
  onSelect,
  initialPath,
  title = "Select File",
  extensions,
}: PathBrowserProps) {
  const [currentPath, setCurrentPath] = useState("/");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // Initialize path when dialog opens
  useEffect(() => {
    if (isOpen) {
      // If we have an initial path, try to use its directory
      // Simple heuristic: if it looks like a file (has extension), take dirname
      let path = initialPath || "/";
      if (path && path.split("/").pop()?.includes(".")) {
        const parts = path.split("/");
        parts.pop();
        path = parts.join("/") || "/";
      }
      // If windows style path...
      if (initialPath && initialPath.includes("\\")) {
        if (initialPath.split("\\").pop()?.includes(".")) {
          const parts = initialPath.split("\\");
          parts.pop();
          path = parts.join("\\") || "C:\\";
        } else {
          path = initialPath;
        }
      }

      setCurrentPath(path);
      if (initialPath) setSelectedPath(initialPath);
    }
  }, [isOpen]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["filesystem", currentPath],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/system/filesystem?path=${encodeURIComponent(currentPath)}`
      );
      if (!res.ok) throw new Error("Failed to load directory");
      return res.json();
    },
    enabled: isOpen,
    retry: false,
  });

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
    setSelectedPath(null);
  };

  const handleSelect = (path: string, isDirectory: boolean) => {
    if (isDirectory) {
      handleNavigate(path);
    } else {
      setSelectedPath(path);
    }
  };

  const handleConfirm = () => {
    if (selectedPath) {
      onSelect(selectedPath);
      onClose();
    }
  };

  const handleManualPath = (e: React.FormEvent) => {
    e.preventDefault();
    refetch();
  };

  // Filter files if extensions provided
  const filteredFiles = data?.files?.filter((file: any) => {
    if (file.isDirectory) return true;
    if (!extensions || extensions.length === 0) return true;
    return extensions.some((ext) => file.name.endsWith(ext));
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleManualPath} className="flex gap-2 my-2">
          <Input
            value={currentPath}
            onChange={(e) => setCurrentPath(e.target.value)}
            className="flex-1 font-mono text-sm"
            placeholder="/path/to/directory"
          />
          <Button type="submit" variant="secondary" size="sm">
            Go
          </Button>
        </form>

        <div className="flex-1 min-h-0 border rounded-md bg-background">
          <ScrollArea className="h-[400px]">
            {isLoading ? (
              <div className="flex items-center justify-center h-full p-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="text-destructive p-8 text-center flex flex-col items-center gap-2">
                <ShieldAlert className="h-8 w-8" />
                <p>Failed to access directory.</p>
                <Button variant="outline" size="sm" onClick={() => setCurrentPath("/")}>
                  Go to Root
                </Button>
              </div>
            ) : (
              <div className="p-1">
                {data?.parent && (
                  <div
                    className="flex items-center gap-2 p-2 hover:bg-accent rounded-sm cursor-pointer select-none"
                    onClick={() => handleNavigate(data.parent.path)}
                  >
                    <ArrowUp className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">..</span>
                  </div>
                )}
                {filteredFiles?.map((file: any) => (
                  <div
                    key={file.name}
                    className={`flex items-center gap-2 p-2 rounded-sm cursor-pointer select-none ${
                      selectedPath === file.path
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent"
                    }`}
                    onClick={() => handleSelect(file.path, file.isDirectory)}
                  >
                    {file.isDirectory ? (
                      <Folder
                        className={`h-4 w-4 ${selectedPath === file.path ? "text-primary-foreground" : "text-blue-500"}`}
                      />
                    ) : (
                      <File
                        className={`h-4 w-4 ${selectedPath === file.path ? "text-primary-foreground" : "text-gray-500"}`}
                      />
                    )}
                    <span className="text-sm truncate font-mono flex-1">{file.name}</span>
                  </div>
                ))}
                {filteredFiles?.length === 0 && (
                  <div className="text-muted-foreground text-sm p-8 text-center italic">
                    No files found
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter>
          <div className="flex justify-between w-full items-center pt-2">
            <div className="text-xs text-muted-foreground truncate max-w-[300px] font-mono mr-2">
              {selectedPath || "No file selected"}
            </div>
            <div className="gap-2 flex">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" onClick={handleConfirm} disabled={!selectedPath}>
                Select
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShieldAlert(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}
