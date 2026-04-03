import * as React from "react";
import { cn } from "@/lib/utils";

interface SegmentedControlItem {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface SegmentedControlProps {
  items: SegmentedControlItem[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

function SegmentedControl({ items, value, onValueChange, className }: SegmentedControlProps) {
  return (
    <div className={cn("inline-flex h-8 border border-border bg-card rounded-none", className)}>
      {items.map((item, index) => (
        <button
          key={item.value}
          type="button"
          className={cn(
            "h-full px-2 text-[10px] font-mono transition-colors",
            index > 0 && "border-l border-border",
            value === item.value
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-accent",
          )}
          onClick={() => onValueChange(item.value)}
        >
          <span className="flex items-center gap-1">
            {item.icon}
            {item.label}
          </span>
        </button>
      ))}
    </div>
  );
}

export { SegmentedControl };
