import { useState, useEffect, useRef } from "react";
import { Plus, X, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCreateTask } from "@/hooks/useTasks";
import { useSettings, useProjectDefaults } from "@/hooks/useSettings";
import { generatePlanPath } from "@aif/shared/browser";

interface Props {
  projectId: string;
}

const DEFAULT_PLAN_PATH = ".ai-factory/PLAN.md";

export function AddTaskForm({ projectId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [autoMode, setAutoMode] = useState(true);
  const [isFix, setIsFix] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [plannerMode, setPlannerMode] = useState<"full" | "fast">("fast");
  const [planPath, setPlanPath] = useState(DEFAULT_PLAN_PATH);
  const [planDocs, setPlanDocs] = useState(false);
  const [planTests, setPlanTests] = useState(false);
  const [skipReview, setSkipReview] = useState(false);
  const [useSubagents, setUseSubagents] = useState(true);
  const [maxReviewIterations, setMaxReviewIterations] = useState(3);
  const createTask = useCreateTask();

  // Track whether the user has manually edited the plan path field.
  // When true, the auto-set effect will not overwrite their edit.
  const userOverride = useRef(false);

  const { data: settings } = useSettings();
  const { data: defaults } = useProjectDefaults(projectId);

  // Derive defaults from server data (no setState in effects)
  const useSubagentsDefault = settings?.useSubagents ?? true;
  const maxReviewIterationsDefault = settings?.maxReviewIterations ?? 3;
  const defaultPlanPath = defaults?.paths?.plan ?? DEFAULT_PLAN_PATH;
  const plansDir = defaults?.paths?.plans ?? ".ai-factory/plans/";

  // A generation counter that triggers sync of server defaults into local form state.
  // Bumped when the form opens; the sync effect reacts to it.
  const [syncGen, setSyncGen] = useState(0);

  // Listen for global task:create event (Ctrl+N)
  useEffect(() => {
    const handleCreateTask = () => {
      setSyncGen((g) => g + 1);
      setIsOpen(true);
    };
    window.addEventListener("task:create", handleCreateTask);
    return () => window.removeEventListener("task:create", handleCreateTask);
  }, []);

  // Sync local form state with server defaults when form opens (syncGen changes)
  useEffect(() => {
    if (syncGen === 0) return;
    setUseSubagents(useSubagentsDefault);
    setMaxReviewIterations(maxReviewIterationsDefault);
    setPlanPath(defaultPlanPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncGen]);

  // Close form on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Auto-update planPath when title or mode changes (unless user manually edited the field).
  // Called from onChange handlers rather than useEffect to avoid cascading renders.
  const syncPlanPath = (nextTitle: string, nextMode: "full" | "fast") => {
    if (userOverride.current) return;
    const path = generatePlanPath(nextTitle.trim(), nextMode, {
      plansDir,
      defaultPlanPath,
    });
    setPlanPath(path);
    if (nextTitle.trim()) {
      console.debug("[kanban] Auto-set plan path:", path);
    }
  };

  const handleTitleChange = (value: string) => {
    setTitle(value);
    syncPlanPath(value, plannerMode);
  };

  const handleModeChange = (mode: "full" | "fast") => {
    setPlannerMode(mode);
    syncPlanPath(title, mode);
  };

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
        plannerMode,
        planPath: planPath.trim() || defaultPlanPath,
        planDocs,
        planTests,
        skipReview,
        useSubagents,
        maxReviewIterations,
      },
      {
        onSuccess: () => {
          setTitle("");
          setDescription("");
          setAutoMode(true);
          setIsFix(false);
          setShowAdvanced(false);
          setPlannerMode("full");
          setPlanPath(defaultPlanPath);
          setPlanDocs(false);
          setPlanTests(false);
          setSkipReview(false);
          setUseSubagents(useSubagentsDefault);
          setMaxReviewIterations(maxReviewIterationsDefault);
          userOverride.current = false;
          setIsOpen(false);
        },
        onError: (error) => {
          console.error("[kanban] Failed to create task", error);
        },
      },
    );
  };

  if (!isOpen) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-center gap-1 border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
        onClick={() => {
          setSyncGen((g) => g + 1);
          setIsOpen(true);
        }}
        type="button"
      >
        <Plus className="h-4 w-4" />
        Add task
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">Ctrl+N</span>
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 border border-border bg-background/65 p-2.5">
      <Input
        placeholder="Task title"
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        autoFocus
      />
      <Textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
      />
      <div className="space-y-2 border border-border/60 bg-muted/20 p-2">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Task type
          </p>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="radio"
              name="taskType"
              aria-label="Standard"
              checked={!isFix}
              onChange={() => setIsFix(false)}
              className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-primary)]"
            />
            <span>
              <span className="font-medium text-foreground">Standard</span>
              {" - Default task flow."}
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="radio"
              name="taskType"
              aria-label="Fix"
              checked={isFix}
              onChange={() => setIsFix(true)}
              className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-primary)]"
            />
            <span>
              <span className="font-medium text-foreground">Fix</span>
              {
                " - Use when something is not working correctly or is broken; a patch will be created for the self-learning system."
              }
            </span>
          </label>
        </div>
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            aria-label="Auto mode"
            checked={autoMode}
            onChange={(e) => setAutoMode(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-primary)]"
          />
          <span>
            <span className="font-medium text-foreground">Auto mode</span>
            {
              " - AI moves tasks between statuses automatically; the user only starts the process and verifies the result."
            }
          </span>
        </label>
      </div>
      {!isFix && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Planner settings
          </button>
          {showAdvanced && (
            <div className="space-y-2 border border-border/60 bg-muted/20 p-2">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Mode
                </p>
                <div className="flex gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="radio"
                      name="plannerMode"
                      checked={plannerMode === "full"}
                      onChange={() => handleModeChange("full")}
                      className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                    />
                    <span className="font-medium text-foreground">Full</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="radio"
                      name="plannerMode"
                      checked={plannerMode === "fast"}
                      onChange={() => handleModeChange("fast")}
                      className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                    />
                    <span className="font-medium text-foreground">Fast</span>
                  </label>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Plan file path
                </p>
                <Input
                  value={planPath}
                  onChange={(e) => {
                    userOverride.current = true;
                    setPlanPath(e.target.value);
                  }}
                  placeholder={defaultPlanPath}
                  className="h-7 text-xs"
                />
                <p className="text-[10px] text-muted-foreground/70">
                  Preview — server may adjust based on project config
                </p>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={planDocs}
                    onChange={(e) => setPlanDocs(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                  />
                  <span className="font-medium text-foreground">Docs</span>
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={planTests}
                    onChange={(e) => setPlanTests(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                  />
                  <span className="font-medium text-foreground">Tests</span>
                </label>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="space-y-1">
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={skipReview}
            onChange={(e) => setSkipReview(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-primary)]"
          />
          <span>
            <span className="font-medium text-foreground">Skip review</span>
            {" - After implementation, move directly to done without code review."}
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={useSubagents}
            onChange={(e) => setUseSubagents(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-primary)]"
          />
          <span>
            <span className="font-medium text-foreground">Use subagents</span>
            {
              " - Run via custom subagents (plan-coordinator, implement-coordinator, sidecars). Disable to use aif-* skills directly."
            }
          </span>
        </label>
      </div>
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
            setShowAdvanced(false);
            setPlannerMode("full");
            setPlanPath(defaultPlanPath);
            setPlanDocs(false);
            setPlanTests(false);
            setSkipReview(false);
            setUseSubagents(useSubagentsDefault);
            setMaxReviewIterations(maxReviewIterationsDefault);
            userOverride.current = false;
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
