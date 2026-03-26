import { Markdown } from "@/components/ui/markdown";

interface TaskLogProps {
  log: string | null;
  label: string;
}

export function TaskLog({ log, label }: TaskLogProps) {
  if (!log) {
    return (
      <div className="text-sm text-muted-foreground italic">
        No {label.toLowerCase()} yet
      </div>
    );
  }

  return (
    <div className="max-h-64 overflow-x-auto overflow-y-auto border border-border bg-secondary/40 p-3">
      <Markdown content={log} className="text-xs text-foreground/90" />
    </div>
  );
}
