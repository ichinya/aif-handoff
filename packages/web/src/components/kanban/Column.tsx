import type { Task, TaskStatus } from "@aif/shared/browser";
import { STATUS_CONFIG } from "@aif/shared/browser";
import { TaskCard } from "./TaskCard";
import { AddTaskForm } from "./AddTaskForm";

interface ColumnProps {
  status: TaskStatus;
  tasks: Task[];
  projectId: string;
  onTaskClick: (taskId: string) => void;
  totalVisibleTasks: number;
  density: "comfortable" | "compact";
  hasActiveFilters: boolean;
}

const OWNER_BADGE: Record<TaskStatus, { label: string; className: string }> = {
  backlog: { label: "Human controlled", className: "text-cyan-300 border-cyan-500/35 bg-cyan-500/10" },
  planning: { label: "AI controlled", className: "text-amber-300 border-amber-500/35 bg-amber-500/10" },
  plan_ready: { label: "AI controlled", className: "text-amber-300 border-amber-500/35 bg-amber-500/10" },
  implementing: { label: "AI controlled", className: "text-amber-300 border-amber-500/35 bg-amber-500/10" },
  review: { label: "AI controlled", className: "text-amber-300 border-amber-500/35 bg-amber-500/10" },
  blocked_external: { label: "Human controlled", className: "text-cyan-300 border-cyan-500/35 bg-cyan-500/10" },
  done: { label: "Human decision", className: "text-green-300 border-green-500/35 bg-green-500/10" },
  verified: { label: "Human controlled", className: "text-cyan-300 border-cyan-500/35 bg-cyan-500/10" },
};

export function Column({
  status,
  tasks,
  projectId,
  onTaskClick,
  totalVisibleTasks,
  density,
  hasActiveFilters,
}: ColumnProps) {
  const config = STATUS_CONFIG[status];
  const owner = OWNER_BADGE[status];
  const share = totalVisibleTasks > 0 ? Math.round((tasks.length / totalVisibleTasks) * 100) : 0;

  return (
    <div className="w-80 flex-shrink-0 border border-border bg-card/70 p-3 transition duration-150 hover:border-primary/25">
      <div className="sticky top-0 z-20 -mx-1 mb-3 border-b border-border bg-card/70 px-1 pb-2 backdrop-blur">
        <div className="mb-2 flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: config.color }} />
          <h3 className="text-[13px] font-semibold tracking-tight">{config.label}</h3>
          <span className="ml-auto border border-border bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
            {tasks.length}
          </span>
        </div>

        <div className="h-1 overflow-hidden border border-border bg-secondary/60">
          <div className="h-full transition-all duration-200" style={{ width: `${share}%`, backgroundColor: config.color }} />
        </div>
      </div>

      <div className="mb-3">
        <span className={`inline-flex border px-2 py-0.5 text-[10px] ${owner.className}`}>
          {owner.label}
        </span>
      </div>

      <div className={`min-h-[100px] ${density === "compact" ? "space-y-1.5" : "space-y-2"}`}>
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            density={density}
            onClick={() => onTaskClick(task.id)}
          />
        ))}

        {tasks.length === 0 && (
          <div className="border border-dashed border-border py-8 text-center text-[11px] text-muted-foreground">
            {hasActiveFilters ? "// no tasks for current filters" : "// no tasks"}
          </div>
        )}
      </div>

      {status === "backlog" && (
        <div className="mt-2">
          <AddTaskForm projectId={projectId} />
        </div>
      )}
    </div>
  );
}
