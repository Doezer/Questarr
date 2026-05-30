import React, { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import StatusBadge, { type GameStatus } from "./StatusBadge";
import { cn } from "@/lib/utils";

const USER_SETTABLE_STATUSES: { id: GameStatus; label: string }[] = [
  { id: "wanted", label: "Wanted" },
  { id: "owned", label: "Owned" },
  { id: "shelved", label: "Shelved" },
  { id: "completed", label: "Completed" },
];

interface StatusPickerProps {
  currentStatus: GameStatus;
  onStatusChange: (status: GameStatus) => void;
  /** Shown in the trigger's aria-label: "Change status for <gameTitle>" */
  gameTitle?: string;
  /** data-testid forwarded to the default trigger button */
  "data-testid"?: string;
  /**
   * Custom trigger element. Must forward ref and accept onClick.
   * When provided, it replaces the default badge-button trigger.
   * When the status is "downloading" this is rendered as-is (no popover).
   */
  children?: React.ReactElement;
  /** Extra className applied to the default trigger button (e.g. "w-full"). */
  triggerClassName?: string;
}

/**
 * Replaces the status cycle-button pattern.
 * Clicking the trigger opens a small popover with all user-settable statuses
 * as clickable chips. The active status is highlighted with a ring.
 *
 * When `currentStatus` is "downloading" the picker is suppressed — the trigger
 * (or a plain StatusBadge when no children) is rendered non-interactively.
 */
export default function StatusPicker({
  currentStatus,
  onStatusChange,
  gameTitle,
  "data-testid": testId,
  children,
  triggerClassName,
}: StatusPickerProps) {
  const [open, setOpen] = useState(false);

  // Downloading is system-managed — no user interaction
  if (currentStatus === "downloading") {
    return children ? <>{children}</> : <StatusBadge status={currentStatus} />;
  }

  const defaultTrigger = (
    <button
      type="button"
      data-testid={testId}
      aria-label={gameTitle ? `Change status for ${gameTitle}` : "Change status"}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        triggerClassName
      )}
    >
      <StatusBadge status={currentStatus} />
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children ?? defaultTrigger}</PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <p className="text-xs text-muted-foreground mb-2">Change status</p>
        <div className="flex flex-wrap gap-1.5">
          {USER_SETTABLE_STATUSES.map(({ id }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                onStatusChange(id);
                setOpen(false);
              }}
              aria-pressed={currentStatus === id}
              aria-label={id}
              className={cn(
                "rounded transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                currentStatus === id && "ring-2 ring-primary ring-offset-1 ring-offset-background"
              )}
            >
              <StatusBadge status={id} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
