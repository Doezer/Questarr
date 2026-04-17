import React from "react";
import { Search, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface GameFilterPillsProps {
  showSearchResultsOnly: boolean;
  setShowSearchResultsOnly: (value: boolean) => void;
  showDownloadsOnly: boolean;
  setShowDownloadsOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  showUpdateAvailableOnly?: boolean;
  setShowUpdateAvailableOnly?: (value: boolean | ((prev: boolean) => boolean)) => void;
}

export default function GameFilterPills({
  showSearchResultsOnly,
  setShowSearchResultsOnly,
  showDownloadsOnly,
  setShowDownloadsOnly,
  showUpdateAvailableOnly = false,
  setShowUpdateAvailableOnly,
}: Readonly<GameFilterPillsProps>) {
  return (
    <>
      <Button
        variant={showSearchResultsOnly ? "default" : "outline"}
        size="sm"
        className="h-7 gap-1.5 text-xs"
        onClick={() => setShowSearchResultsOnly(!showSearchResultsOnly)}
        aria-label="Show games with search results only"
      >
        <Search className="h-3 w-3" />
        Has Results
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={showDownloadsOnly ? "default" : "outline"}
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setShowDownloadsOnly((v) => !v)}
            aria-label={showDownloadsOnly ? "Show all games" : "Show games with downloads only"}
          >
            <Download className="h-3 w-3" />
            Has Downloads
          </Button>
        </TooltipTrigger>
        <TooltipContent>{showDownloadsOnly ? "Show all" : "Has downloads"}</TooltipContent>
      </Tooltip>
      {setShowUpdateAvailableOnly && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={showUpdateAvailableOnly ? "default" : "outline"}
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setShowUpdateAvailableOnly((v) => !v)}
              aria-label={
                showUpdateAvailableOnly ? "Show all games" : "Show games with update downloads only"
              }
            >
              <RefreshCw className="h-3 w-3" />
              Update Available
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {showUpdateAvailableOnly ? "Show all" : "Has update downloads"}
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
}
