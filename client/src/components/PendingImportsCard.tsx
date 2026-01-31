import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import ImportReviewModal from "./ImportReviewModal";
import { formatDistanceToNow } from "date-fns";

interface PendingImport {
    id: string;
    gameTitle: string;
    downloadTitle: string;
    status: string;
    createdAt: string;
}

export default function PendingImportsCard() {
    const { data: pendingImports = [] } = useQuery<PendingImport[]>({
        queryKey: ["/api/imports/pending"],
        refetchInterval: 30000 // Poll every 30s
    });

    const [selectedImport, setSelectedImport] = useState<PendingImport | null>(null);

    if (pendingImports.length === 0) return null;

    return (
        <>
            <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900">
                <CardHeader className="pb-3">
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
                        <AlertCircle className="h-5 w-5" />
                        <CardTitle className="text-lg">Pending Manual Imports</CardTitle>
                    </div>
                    <CardDescription>
                        The following downloads require your attention before they can be added to your library.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {pendingImports.map((item) => (
                            <div key={item.id} className="flex items-center justify-between bg-background p-3 rounded-md border shadow-sm">
                                <div className="space-y-1">
                                    <p className="font-medium text-sm">{item.gameTitle || item.downloadTitle}</p>
                                    <p className="text-xs text-muted-foreground truncate max-w-[300px]" title={item.downloadTitle}>
                                        {item.downloadTitle}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {item.createdAt && formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                                    </p>
                                </div>
                                <Button size="sm" onClick={() => setSelectedImport(item)}>
                                    Review
                                </Button>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {selectedImport && (
                <ImportReviewModal
                    open={!!selectedImport}
                    onOpenChange={(open) => !open && setSelectedImport(null)}
                    downloadId={selectedImport.id}
                    downloadTitle={selectedImport.downloadTitle}
                />
            )}
        </>
    );
}
