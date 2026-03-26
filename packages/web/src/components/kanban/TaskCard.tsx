import { STATUS_CONFIG, type Task } from "@aif/shared/browser";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";

const PRIORITY_LABELS: Record<number, { label: string; className: string }> = {
  0: { label: "None", className: "hidden" },
  1: { label: "Low", className: "border-cyan-500/35 bg-cyan-500/15 text-cyan-300" },
  2: { label: "Medium", className: "border-amber-500/35 bg-amber-500/15 text-amber-300" },
  3: { label: "High", className: "border-orange-500/35 bg-orange-500/15 text-orange-300" },
  4: { label: "Urgent", className: "border-red-500/35 bg-red-500/15 text-red-300" },
  5: { label: "Critical", className: "border-red-600/35 bg-red-600/15 text-red-200" },
};

interface TaskCardProps {
  task: Task;
  onClick: () => void;
  overlay?: boolean;
  density?: "comfortable" | "compact";
}

function shortTaskId(id: string) {
  return id.slice(0, 8);
}

export function TaskCard({ task, onClick, overlay, density = "comfortable" }: TaskCardProps) {
  const priority = PRIORITY_LABELS[task.priority] ?? PRIORITY_LABELS[0];

  if (overlay) {
    return (
      <div className="w-80 rotate-1 border border-border bg-card p-3 shadow-[0_8px_32px_rgba(0,0,0,0.45)]">
        <div className="text-sm font-medium tracking-tight">{task.title}</div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className="group relative cursor-pointer overflow-hidden border border-border bg-card/95 p-3 transition duration-150 hover:-translate-y-0.5 hover:border-primary/45"
    >
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ backgroundColor: STATUS_CONFIG[task.status].color }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className={`${density === "compact" ? "text-[13px]" : "text-sm"} pl-2 font-medium leading-tight tracking-tight`}>
          {task.title}
        </div>
        {priority.label !== "None" && (
          <Badge className={`shrink-0 px-1.5 py-0 text-[10px] ${priority.className}`}>
            {priority.label}
          </Badge>
        )}
      </div>

      {task.description && (
        <div className={`line-clamp-2 pl-2 text-xs text-muted-foreground ${density === "compact" ? "mt-1" : "mt-1.5"}`}>
          {task.description}
        </div>
      )}

      {task.status === "blocked_external" && task.blockedReason && (
        <div className="mt-2 ml-2 border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-300 line-clamp-2">
          {task.blockedReason}
        </div>
      )}

      <div className={`border-t border-border pl-2 font-mono text-[10px] text-muted-foreground/70 ${density === "compact" ? "mt-1.5 pt-1.5" : "mt-2 pt-2"}`}>
        #{shortTaskId(task.id)} · {timeAgo(task.updatedAt)} · {task.autoMode ? "AI" : "MANUAL"}
      </div>
    </div>
  );
}
