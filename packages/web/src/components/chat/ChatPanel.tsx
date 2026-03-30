import { useRef, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Send, Trash2, Bot, User, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/ui/markdown";
import { Badge } from "@/components/ui/badge";
import { useChat } from "@/hooks/useChat";
import type { ChatMessage } from "@aif/shared/browser";

interface ChatPanelProps {
  isOpen: boolean;
  projectId: string | null;
  onClose: () => void;
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-2.5 px-3 py-2", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs",
          isUser ? "bg-blue-600 text-white" : "bg-violet-600 text-white",
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm",
          isUser ? "bg-blue-600/15 text-foreground" : "bg-violet-600/15 text-foreground",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <Markdown content={message.content} className="text-sm" />
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-2.5 px-3 py-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white text-xs">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="flex items-center gap-1 rounded-lg bg-violet-600/15 px-3 py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
        <span className="text-xs text-muted-foreground">Thinking...</span>
      </div>
    </div>
  );
}

export function ChatPanel({ isOpen, projectId, onClose }: ChatPanelProps) {
  const { messages, isStreaming, chatErrorCode, explore, setExplore, sendMessage, clearMessages } =
    useChat(projectId);
  const [input, setInput] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  // Focus textarea when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 300);
    }
  }, [isOpen]);

  // Close chat on Escape key or outside click while open
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!panelRef.current?.contains(target)) onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [isOpen, onClose]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    void sendMessage(input);
    setInput("");
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const showTypingIndicator = isStreaming && messages[messages.length - 1]?.role !== "assistant";

  return (
    <div
      ref={panelRef}
      className={cn(
        "fixed bottom-0 left-0 z-[60] flex h-[calc(100vh-3.5rem)] w-[800px] flex-col",
        "border-r border-border bg-background shadow-xl",
        "transition-transform duration-300 ease-in-out",
        isOpen ? "translate-x-0" : "-translate-x-full",
      )}
      style={{ top: "3.5rem" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">AI Chat</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={explore}
              onChange={(e) => setExplore(e.target.checked)}
              className="accent-primary h-3.5 w-3.5"
            />
            Explore
          </label>
          <button
            onClick={clearMessages}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Clear messages"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Close chat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto py-2">
        {chatErrorCode === "CHAT_USAGE_LIMIT" && (
          <div className="px-3 pb-2">
            <div className="rounded border border-amber-500/50 bg-amber-500/15 p-2">
              <Badge
                variant="outline"
                className="border-amber-600/60 text-amber-700 dark:border-amber-400/50 dark:text-amber-300"
              >
                Usage Limit Reached
              </Badge>
              <p className="mt-1 text-xs text-amber-700/90 dark:text-amber-200/90">
                Claude usage limit is currently exhausted. Wait for reset time and send again.
              </p>
            </div>
          </div>
        )}
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Bot className="h-8 w-8 opacity-30" />
            <p className="text-xs">Ask anything about this project</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        {showTypingIndicator && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question..."
            rows={1}
            className={cn(
              "flex-1 resize-none rounded border border-border bg-secondary/50 px-3 py-2",
              "text-sm text-foreground placeholder:text-muted-foreground",
              "focus:border-primary/50 focus:outline-none",
              "max-h-32 min-h-[2.25rem]",
            )}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded",
              "bg-primary text-primary-foreground",
              "transition-colors hover:bg-primary/90",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
