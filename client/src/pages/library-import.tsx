import { FolderInput } from "lucide-react";
import { RootFolderDiscovery } from "@/components/RootFolderDiscovery";

export default function LibraryImportPage() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-[#374151]/40">
        <FolderInput className="w-5 h-5 text-blue-400" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-white">Library Import</h1>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        <RootFolderDiscovery />
      </div>
    </div>
  );
}
