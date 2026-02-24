import { useState, useEffect } from "react";
import { Folder, File, ChevronRight, CornerLeftUp, Loader2, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
}

export function FileBrowser({ open, onOpenChange, onSelect, initialPath = "/", title = "Select Directory" }: FileBrowserProps) {
    const [currentPath, setCurrentPath] = useState(initialPath);
    const [data, setData] = useState<BrowseResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            loadPath(currentPath);
        }
    }, [open, currentPath]);

    const loadPath = async (path: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiRequest("GET", `/api/system/browse?path=${encodeURIComponent(path)}`);
            if (!res.ok) throw new Error("Failed to load directory");
            const json = await res.json();
            setData(json);
        } catch (err) {
            console.error("FileBrowser error:", err);
            setError("Failed to load directory");
        } finally {
            setLoading(false);
        }
    };

    const handleNavigate = (path: string) => {
        setCurrentPath(path);
    };

    const handleUp = () => {
        if (data?.parent) {
            setCurrentPath(data.parent);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl h-[500px] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
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

                <ScrollArea className="flex-1 border rounded-md">
                    {loading ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : error ? (
                        <div className="flex items-center justify-center h-40 text-destructive">
                            {error}
                        </div>
                    ) : (
                        <div className="p-1 space-y-1">
                            {data?.items.length === 0 && (
                                <div className="text-center text-sm text-muted-foreground py-4">
                                    Empty directory
                                </div>
                            )}
                            {data?.items.map((item) => (
                                <div
                                    key={item.path}
                                    className={`
                    flex items-center gap-2 p-2 rounded-sm cursor-pointer hover:bg-accent
                    ${!item.isDirectory ? "opacity-50 cursor-default" : ""}
                  `}
                                    onClick={() => item.isDirectory && handleNavigate(item.path)}
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
                    )}
                </ScrollArea>

                <div className="flex justify-end pt-4 gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={() => {
                        onSelect(currentPath);
                        onOpenChange(false);
                    }}>
                        Select Current
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
