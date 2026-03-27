import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCreateTask } from "@/hooks/useTasks";

interface Props {
  projectId: string;
}

export function AddTaskForm({ projectId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [autoMode, setAutoMode] = useState(true);
  const [isFix, setIsFix] = useState(false);
  const createTask = useCreateTask();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    console.debug("[kanban] Creating task:", title);
    createTask.mutate(
      {
        projectId,
        title: title.trim(),
        description: description.trim(),
        autoMode,
        isFix,
      },
      {
        onSuccess: () => {
          setTitle("");
          setDescription("");
          setAutoMode(true);
          setIsFix(false);
          setIsOpen(false);
        },
        onError: (error) => {
          console.error("[kanban] Failed to create task", error);
        },
      }
    );
  };

  if (!isOpen) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
        onClick={() => setIsOpen(true)}
      >
        <Plus className="h-4 w-4 mr-1" />
        Add task
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 border border-border bg-background/65 p-2.5">
      <Input
        placeholder="Task title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
      />
      <Textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={autoMode}
          onChange={(e) => setAutoMode(e.target.checked)}
          className="h-3.5 w-3.5 accent-[var(--color-primary)]"
        />
        Auto mode
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={isFix}
          onChange={(e) => setIsFix(e.target.checked)}
          className="h-3.5 w-3.5 accent-[var(--color-primary)]"
        />
        Fix
      </label>
      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" disabled={!title.trim() || createTask.isPending}>
          {createTask.isPending ? "Adding..." : "Add"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setIsOpen(false);
            setTitle("");
            setDescription("");
            setAutoMode(true);
            setIsFix(false);
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
