import * as React from "react";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type SwitchProps = Omit<
  React.ComponentPropsWithoutRef<typeof Switch>,
  "id" | "aria-labelledby" | "aria-describedby"
>;

export interface SettingRowProps extends SwitchProps {
  /** Id of the switch; the whole row is its label. */
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  /** Extra content rendered under the description, still inside the row (e.g. an error line). */
  extra?: React.ReactNode;
}

/**
 * A setting that is turned on or off: label and help text on the left, switch on the right.
 * The whole row is the click target (at least 44px tall), not only the 44x24 switch, and the
 * label and description are exposed to assistive tech through aria-labelledby/-describedby.
 */
const SettingRow = React.forwardRef<React.ElementRef<typeof Switch>, SettingRowProps>(
  ({ id, label, description, extra, className, ...switchProps }, ref) => {
    const labelId = `${id}-label`;
    const descriptionId = description ? `${id}-description` : undefined;
    return (
      <label
        htmlFor={id}
        className={cn(
          "flex min-h-11 cursor-pointer items-center justify-between gap-4 has-[button:disabled]:cursor-not-allowed",
          className
        )}
      >
        <span className="space-y-0.5">
          <span id={labelId} className="block text-sm font-medium leading-none">
            {label}
          </span>
          {description && (
            <span id={descriptionId} className="block text-xs text-muted-foreground">
              {description}
            </span>
          )}
          {extra}
        </span>
        <Switch
          ref={ref}
          id={id}
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          {...switchProps}
        />
      </label>
    );
  }
);
SettingRow.displayName = "SettingRow";

export { SettingRow };
