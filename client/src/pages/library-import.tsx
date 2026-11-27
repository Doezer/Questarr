import { useState, lazy, Suspense } from "react";
import { FolderInput, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RootFolderDiscovery } from "@/components/RootFolderDiscovery";

const ManualImportModal = lazy(() => import("@/components/ManualImportModal"));

export default function LibraryImportPage() {
  const [manualImportOpen, setManualImportOpen] = useState(false);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-3 px-6 py-5 border-b border-border">
        <div className="flex min-w-0 items-center gap-3">
          <FolderInput className="w-5 h-5 text-primary" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-foreground">Library Import</h1>
        </div>
        <Button variant="outline" onClick={() => setManualImportOpen(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Manual Import
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        <RootFolderDiscovery />
      </div>

      <Suspense fallback={<div className="fixed inset-0 bg-background/80 backdrop-blur-sm" />}>
        <ManualImportModal open={manualImportOpen} onOpenChange={setManualImportOpen} />
      </Suspense>
    </div>
  );
}
