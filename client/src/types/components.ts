import React from "react";

/**
 * A Lucide-compatible icon component type used across UI components.
 * Supports optional className and aria-hidden for accessibility.
 */
export type IconComponent = React.ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;
