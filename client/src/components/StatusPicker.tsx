import React, { useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import StatusBadge, { getStatusLabel, getStatusVisual, type GameStatus } from "./StatusBadge";
import { cn } from "@/lib/utils";

const USER_SETTABLE_STATUSES: { id: GameStatus; label: string }[] = [
  { id: "wanted", label: "Wanted" },
  { id: "owned", label: "Owned" },
  { id: "shelved", label: "Shelved" },
  { id: "completed", label: "Completed" },
];

interface StatusPickerProps {
  readonly currentStatus: GameStatus;
  readonly onStatusChange: (status: GameStatus) => void;
  /** Shown in the trigger's aria-label: "Change status for <gameTitle>" */
  readonly gameTitle?: string;
  /** data-testid forwarded to the default trigger button */
  readonly "data-testid"?: string;
  /**
   * Custom trigger element. Must forward ref and accept onClick.
   * When provided, it replaces the default badge-button trigger.
   * When the status is "downloading" this is rendered as-is (no popover).
   */
  readonly children?: React.ReactElement;
  /** Extra className applied to the default trigger button (e.g. "w-full"). */
  readonly triggerClassName?: string;
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

  const { Icon: CurrentIcon, iconColorClass: currentIconColorClass } =
    getStatusVisual(currentStatus);

  const defaultTrigger = (
    <button
      type="button"
      data-testid={testId}
      aria-label={gameTitle ? `Change status for ${gameTitle}` : "Change status"}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-secondary/40 px-3 text-xs font-medium text-foreground transition-colors",
        "hover:bg-secondary hover:border-primary/50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        triggerClassName
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {CurrentIcon && (
          <CurrentIcon className={cn("h-3.5 w-3.5 shrink-0", currentIconColorClass)} />
        )}
        <span className="truncate">
          Status: <span className="font-semibold">{getStatusLabel(currentStatus)}</span>
        </span>
      </span>
      <ChevronDown
        className={cn(
          "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
          open && "rotate-180"
        )}
        aria-hidden="true"
      />
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children ?? defaultTrigger}</PopoverTrigger>
      <PopoverContent className="w-48 p-1.5" align="start" onClick={(e) => e.stopPropagation()}>
        <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">Change status</p>
        <div className="flex flex-col gap-0.5">
          {USER_SETTABLE_STATUSES.map(({ id, label }) => {
            const isActive = currentStatus === id;
            const { Icon, iconColorClass } = getStatusVisual(id);
            return (
              <button
                key={id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onStatusChange(id);
                  setOpen(false);
                }}
                aria-pressed={isActive}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
                  "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive && "bg-accent/70 font-medium"
                )}
              >
                <span className="flex items-center gap-2">
                  {Icon && <Icon className={cn("h-3.5 w-3.5 shrink-0", iconColorClass)} />}
                  {label}
                </span>
                {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
