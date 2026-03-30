import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatBubbleProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function ChatBubble({ isOpen, onToggle }: ChatBubbleProps) {
  if (isOpen) return null;

  return (
    <button
      onClick={onToggle}
      className={cn(
        "fixed bottom-6 left-6 z-[70] flex h-14 w-14 items-center justify-center rounded-full",
        "bg-primary text-primary-foreground shadow-lg",
        "transition-all duration-300 ease-in-out",
        "hover:scale-105 hover:shadow-xl",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        "animate-pulse-glow",
      )}
      aria-label="Open chat"
    >
      <Bot className="h-6 w-6" />
    </button>
  );
}
