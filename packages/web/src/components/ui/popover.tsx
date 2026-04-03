import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  createOverlayLayerId,
  isTopOverlayLayer,
  pushOverlayLayer,
} from "@/components/ui/overlayStack";

interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  className?: string;
}

function Popover({
  open,
  onOpenChange,
  children,
  content,
  side = "bottom",
  align = "start",
  className,
}: PopoverProps) {
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const overlayLayerId = React.useRef(createOverlayLayerId("popover"));
  const [coords, setCoords] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });

  React.useEffect(() => {
    if (!open) return;
    return pushOverlayLayer(overlayLayerId.current);
  }, [open]);

  React.useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setCoords(computePosition(rect, side, align));
  }, [open, side, align]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!isTopOverlayLayer(overlayLayerId.current)) return;
      onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  React.useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open, onOpenChange]);

  return (
    <>
      <span ref={triggerRef} onClick={() => onOpenChange(!open)}>
        {children}
      </span>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            className={cn(
              "fixed z-50 bg-popover text-popover-foreground border border-border p-3 rounded-none shadow-lg",
              className,
            )}
            style={{ top: coords.top, left: coords.left }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

function computePosition(
  rect: DOMRect,
  side: "top" | "bottom",
  align: "start" | "center" | "end",
): { top: number; left: number } {
  const gap = 4;
  const top = side === "bottom" ? rect.bottom + gap : rect.top - gap;
  let left: number;
  switch (align) {
    case "start":
      left = rect.left;
      break;
    case "center":
      left = rect.left + rect.width / 2;
      break;
    case "end":
      left = rect.right;
      break;
  }
  return { top, left };
}

export { Popover };
export type { PopoverProps };
