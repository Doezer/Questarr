import React from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  actionLink?: string;
  className?: string;
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionLink,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center py-16 px-4 text-center", className)}
      data-testid="empty-state"
    >
      <div className="bg-muted/50 p-6 rounded-full mb-6 ring-1 ring-border">
        <Icon className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="text-xl font-semibold mb-2 tracking-tight">{title}</h3>
      <p className="text-muted-foreground max-w-sm mb-8 text-sm">{description}</p>
      {actionLabel && actionLink && (
        <Button size="lg" className="font-semibold" asChild>
          <Link href={actionLink}>{actionLabel}</Link>
        </Button>
      )}
    </div>
  );
}
