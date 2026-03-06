import React from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

interface LazyModalFallbackProps {
  message?: string;
}

export default function LazyModalFallback({ message = "Loading..." }: LazyModalFallbackProps) {
  return (
    <Dialog open>
      <DialogContent className="sm:max-w-md" data-testid="lazy-modal-fallback">
        <DialogTitle className="sr-only">Loading modal</DialogTitle>
        <DialogDescription className="sr-only">Please wait while content loads.</DialogDescription>
        <div
          className="flex h-32 items-center justify-center gap-2"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm text-muted-foreground">{message}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
