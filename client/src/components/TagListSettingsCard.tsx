import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RotateCcw, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import TagListEditor from "@/components/TagListEditor";

type EditorProps = Omit<React.ComponentProps<typeof TagListEditor>, "tags" | "onChange">;

interface TagListSettingsCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  editor: EditorProps;
  /** Body sent to PATCH /api/settings when the user saves. */
  buildPayload: () => Record<string, unknown>;
  successTitle: string;
  successDescription: string;
  saveLabel: string;
  onReset: () => void;
  children?: React.ReactNode;
  /** Content rendered below the save row, for parts of the card the save button doesn't cover. */
  footer?: React.ReactNode;
}

/** Settings card for a user-editable list of release-name tags, saved via PATCH /api/settings. */
export default function TagListSettingsCard({
  icon: Icon,
  title,
  description,
  tags,
  onTagsChange,
  editor,
  buildPayload,
  successTitle,
  successDescription,
  saveLabel,
  onReset,
  children,
  footer,
}: Readonly<TagListSettingsCardProps>) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/settings", buildPayload());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: successTitle, description: successDescription });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (error: Error) => {
      toast({ title: "Save Failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-3">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <TagListEditor tags={tags} onChange={onTagsChange} {...editor} />
          {children}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            disabled={saveMutation.isPending}
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="gap-2"
          >
            <Save className={saveMutation.isPending ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
            {saveMutation.isPending ? "Saving..." : saveLabel}
          </Button>
        </div>

        {footer && <div className="pt-4 border-t">{footer}</div>}
      </CardContent>
    </Card>
  );
}
