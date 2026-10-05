import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { type GameFileCategory, type ScannedGameFile } from "@shared/schema";

const CATEGORY_OPTIONS: Array<{ value: GameFileCategory; label: string }> = [
  { value: "main", label: "Main game" },
  { value: "dlc", label: "DLC" },
  { value: "update", label: "Update" },
  { value: "extra", label: "Extra" },
];

interface FileCategorySelectProps {
  gameId: string;
  file: ScannedGameFile;
}

/**
 * Lets the user correct the category the library scan guessed for a file.
 * The choice is stored server-side and kept by later scans.
 */
export default function FileCategorySelect({ gameId, file }: FileCategorySelectProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const filesKey = [`/api/games/${gameId}/files`];

  const mutation = useMutation({
    mutationFn: async (category: GameFileCategory) => {
      const res = await apiRequest("PATCH", `/api/games/${gameId}/files/category`, {
        path: file.path,
        category,
      });
      return res.json();
    },
    onSuccess: (_data, category) => {
      queryClient.setQueryData<ScannedGameFile[]>(filesKey, (files) =>
        files?.map((f) => (f.path === file.path ? { ...f, category } : f))
      );
    },
    onError: (error: Error) => {
      toast({
        title: "Could not change the category",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Select
      value={file.category}
      onValueChange={(value) => mutation.mutate(value as GameFileCategory)}
      disabled={mutation.isPending}
    >
      <SelectTrigger
        className="h-9 w-[7.5rem] shrink-0 text-xs"
        aria-label={`Category for ${file.name}`}
        data-testid={`select-file-category-${file.name}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CATEGORY_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
