import { useEffect, useMemo, useRef, useState } from "react";
import { Bot } from "lucide-react";

interface AgentTimelineProps {
  activityLog: string | null;
}

type ActivityKind = "tool" | "error" | "info";
type ActivityFilter = "all" | "tool" | "error";

interface ParsedEntry {
  raw: string;
  timestamp: string | null;
  message: string;
  kind: ActivityKind;
  toolName?: string;
}

function parseEntry(line: string): ParsedEntry {
  const trimmed = line.trim();
  const tsMatch = trimmed.match(/^\[([^\]]+)\]\s*(.*)$/);
  const timestamp = tsMatch ? tsMatch[1] : null;
  const content = (tsMatch ? tsMatch[2] : trimmed).trim();

  const toolMatch = content.match(/^Tool:\s*(.+)$/i);
  if (toolMatch) {
    return {
      raw: line,
      timestamp,
      message: content,
      kind: "tool",
      toolName: toolMatch[1].trim(),
    };
  }

  const lower = content.toLowerCase();
  const kind: ActivityKind =
    lower.includes("failed") || lower.includes("error") ? "error" : "info";

  return {
    raw: line,
    timestamp,
    message: content,
    kind,
  };
}

function kindBadge(kind: ActivityKind): { label: string; className: string } {
  switch (kind) {
    case "tool":
      return {
        label: "TOOL",
        className: "border-cyan-500/35 bg-cyan-500/10 text-cyan-300",
      };
    case "error":
      return {
        label: "ERROR",
        className: "border-red-500/35 bg-red-500/10 text-red-300",
      };
    default:
      return {
        label: "INFO",
        className: "border-border bg-secondary text-muted-foreground",
      };
  }
}

export function AgentTimeline({ activityLog }: AgentTimelineProps) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const entries = useMemo(
    () =>
      (activityLog ?? "")
        .split("\n")
        .filter((line) => line.trim().length > 0),
    [activityLog]
  );
  const parsedEntries = useMemo(() => entries.map((entry) => parseEntry(entry)), [entries]);
  const visibleEntries = useMemo(
    () =>
      parsedEntries.filter((entry) => {
        if (filter === "all") return true;
        return entry.kind === filter;
      }),
    [filter, parsedEntries]
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [activityLog, filter]);

  if (!activityLog) {
    return (
      <div className="text-sm text-muted-foreground italic">
        No agent activity yet
      </div>
    );
  }

  return (
    <div className="border border-border bg-secondary/35 p-3">
      <div className="mb-2 flex items-center gap-2">
        <FilterButton label="All" active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterButton label="Tools" active={filter === "tool"} onClick={() => setFilter("tool")} />
        <FilterButton label="Errors" active={filter === "error"} onClick={() => setFilter("error")} />
        <span className="ml-auto text-[10px] text-muted-foreground">{visibleEntries.length}</span>
      </div>

      <div ref={scrollRef} className="max-h-64 space-y-2 overflow-y-auto">
      {visibleEntries.map((parsed, i) => {
        const badge = kindBadge(parsed.kind);

        return (
          <div key={i} className="border border-border bg-background/60 p-2 text-xs">
            <div className="mb-1 flex items-center gap-2">
              <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className={`inline-flex border px-1.5 py-0.5 text-[10px] ${badge.className}`}>
                {badge.label}
              </span>
              {parsed.timestamp && (
                <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                  {parsed.timestamp}
                </span>
              )}
            </div>
            <div className="font-mono text-foreground/80">
              {parsed.toolName ? (
                <>
                  <span className="text-muted-foreground">Tool:</span> {parsed.toolName}
                </>
              ) : (
                parsed.message
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

function FilterButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`border px-2 py-0.5 text-[10px] transition-colors ${
        active
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border bg-background/50 text-muted-foreground hover:bg-background"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
