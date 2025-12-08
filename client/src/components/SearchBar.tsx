import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Filter, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface SearchBarProps {
  onSearch?: (query: string) => void;
  onFilterToggle?: () => void;
  placeholder?: string;
  activeFilters?: string[];
  onRemoveFilter?: (filter: string) => void;
}

export default function SearchBar({ 
  onSearch, 
  onFilterToggle, 
  placeholder = "Search games...",
  activeFilters = [],
  onRemoveFilter
}: SearchBarProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    console.warn(`Search triggered: ${searchQuery}`);
    onSearch?.(searchQuery);
  };

  // Trigger search on input change for live search
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    console.warn(`Search input change: ${value}`);
    onSearch?.(value);
  };

  const handleFilterClick = () => {
    console.warn("Filter toggle triggered");
    onFilterToggle?.();
  };

  const handleRemoveFilter = (filter: string) => {
    console.warn(`Remove filter triggered: ${filter}`);
    onRemoveFilter?.(filter);
  };

  return (
    <div className="space-y-3">
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            type="search"
            placeholder={placeholder}
            value={searchQuery}
            onChange={handleInputChange}
            className="pl-10"
            data-testid="input-search"
          />
        </div>
        <Button type="submit" variant="default" data-testid="button-search">
          <Search className="w-4 h-4" />
        </Button>
        <Button 
          type="button" 
          variant="outline" 
          onClick={handleFilterClick}
          data-testid="button-filter"
        >
          <Filter className="w-4 h-4" />
        </Button>
      </form>
      
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeFilters.map((filter) => (
            <Badge 
              key={filter} 
              variant="secondary" 
              className="gap-1"
              data-testid={`filter-${filter.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {filter}
              <Button
                variant="ghost"
                size="icon"
                className="w-3 h-3 p-0 hover:bg-transparent"
                onClick={() => handleRemoveFilter(filter)}
                data-testid={`button-remove-filter-${filter.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <X className="w-3 h-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}