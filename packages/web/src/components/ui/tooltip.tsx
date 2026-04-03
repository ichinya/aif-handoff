import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface TooltipProps {
  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
  children: React.ReactElement;
}

function Tooltip({ content, side = "top", className, children }: TooltipProps) {
  const [visible, setVisible] = React.useState(false);
  const [coords, setCoords] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const showTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = React.useCallback(() => {
    showTimer.current = setTimeout(() => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const pos = computePosition(rect, side);
      setCoords(pos);
      setVisible(true);
    }, 150);
  }, [side]);

  const hide = React.useCallback(() => {
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    setVisible(false);
  }, []);

  React.useEffect(() => {
    return () => {
      if (showTimer.current) clearTimeout(showTimer.current);
    };
  }, []);

  return (
    <>
      <span ref={triggerRef} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
        {children}
      </span>
      {visible &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="tooltip"
            className={cn(
              "fixed z-50 bg-popover text-popover-foreground border border-border px-2 py-1 text-xs rounded-none shadow-md",
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
  side: "top" | "bottom" | "left" | "right",
): { top: number; left: number } {
  const gap = 6;
  switch (side) {
    case "top":
      return { top: rect.top - gap, left: rect.left + rect.width / 2 };
    case "bottom":
      return { top: rect.bottom + gap, left: rect.left + rect.width / 2 };
    case "left":
      return { top: rect.top + rect.height / 2, left: rect.left - gap };
    case "right":
      return { top: rect.top + rect.height / 2, left: rect.right + gap };
  }
}

export { Tooltip };
export type { TooltipProps };
