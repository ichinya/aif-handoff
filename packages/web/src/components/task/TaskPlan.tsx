import { Markdown } from "@/components/ui/markdown";

interface TaskPlanProps {
  plan: string | null;
}

export function TaskPlan({ plan }: TaskPlanProps) {
  if (!plan) {
    return (
      <div className="text-sm text-muted-foreground italic">
        No plan generated yet
      </div>
    );
  }

  return (
    <Markdown content={plan} className="text-sm text-foreground/90" />
  );
}
