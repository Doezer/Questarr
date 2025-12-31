import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Filter, X } from "lucide-react";

interface DiscoveryFiltersProps {
  onFiltersChange: (filters: {
    releaseStatus?: "all" | "released" | "upcoming";
    minYear?: number | null;
  }) => void;
}

export default function DiscoveryFilters({ onFiltersChange }: DiscoveryFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [releaseStatus, setReleaseStatus] = useState<"all" | "released" | "upcoming">("all");
  const [minYear, setMinYear] = useState<number | null>(null);

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 30 }, (_, i) => currentYear - i);

  const handleReleaseStatusChange = (status: "all" | "released" | "upcoming") => {
    setReleaseStatus(status);
    onFiltersChange({ releaseStatus: status, minYear });
  };

  const handleMinYearChange = (year: string) => {
    const yearNum = year === "any" ? null : parseInt(year);
    setMinYear(yearNum);
    onFiltersChange({ releaseStatus, minYear: yearNum });
  };

  const clearFilters = () => {
    setReleaseStatus("all");
    setMinYear(null);
    onFiltersChange({ releaseStatus: "all", minYear: null });
  };

  const hasActiveFilters = releaseStatus !== "all" || minYear !== null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(!isOpen)}
          className="gap-2"
          data-testid="button-toggle-filters"
        >
          <Filter className="w-4 h-4" />
          Filters {hasActiveFilters && `(${(releaseStatus !== "all" ? 1 : 0) + (minYear ? 1 : 0)})`}
        </Button>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="gap-2"
            data-testid="button-clear-filters"
          >
            <X className="w-4 h-4" />
            Clear
          </Button>
        )}
      </div>

      {isOpen && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="space-y-2">
              <Label>Release Status</Label>
              <Select
                value={releaseStatus}
                onValueChange={handleReleaseStatusChange}
                data-testid="select-release-status"
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Games</SelectItem>
                  <SelectItem value="released">Released</SelectItem>
                  <SelectItem value="upcoming">Upcoming</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Minimum Release Year</Label>
              <Select
                value={minYear?.toString() || "any"}
                onValueChange={handleMinYearChange}
                data-testid="select-min-year"
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any Year</SelectItem>
                  {years.map((year) => (
                    <SelectItem key={year} value={year.toString()}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
