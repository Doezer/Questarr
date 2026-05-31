import React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  /**
   * Action buttons rendered in a column (full-width) on mobile and a row on
   * desktop. Each button should include `className="h-10 justify-center sm:h-9"`
   * to get a comfortable touch target on mobile and a compact size on desktop.
   */
  actions?: React.ReactNode;
  className?: string;
}

export default function PageHeader({
  title,
  description,
  actions,
  className,
}: Readonly<PageHeaderProps>) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">{actions}</div>}
    </div>
  );
}
