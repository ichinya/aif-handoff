import { useState, useCallback, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Header } from "./components/layout/Header";
import { Board } from "./components/kanban/Board";
import { TaskDetail } from "./components/task/TaskDetail";
import { CommandPalette } from "./components/layout/CommandPalette";
import { useWebSocket } from "./hooks/useWebSocket";
import { useProjects } from "./hooks/useProjects";
import { useTasks } from "./hooks/useTasks";
import { useTheme } from "./hooks/useTheme";
import { Button } from "./components/ui/button";
import type { Project } from "@aif/shared/browser";

const STORAGE_KEY = "aif-selected-project";
const DENSITY_KEY = "aif-density";
const VIEW_MODE_KEY = "aif-view-mode";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchOnWindowFocus: true,
    },
  },
});

function AppContent() {
  useWebSocket();
  const { theme, toggleTheme } = useTheme();
  const { data: projects } = useProjects();
  const [project, setProject] = useState<Project | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [density, setDensity] = useState<"comfortable" | "compact">(() => {
    if (typeof window === "undefined") return "comfortable";
    const saved = localStorage.getItem(DENSITY_KEY);
    return saved === "compact" ? "compact" : "comfortable";
  });
  const [viewMode, setViewMode] = useState<"kanban" | "list">(() => {
    if (typeof window === "undefined") return "kanban";
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    return saved === "list" ? "list" : "kanban";
  });
  const { data: projectTasks } = useTasks(project?.id ?? null);

  useEffect(() => {
    localStorage.setItem(DENSITY_KEY, density);
  }, [density]);

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (!projects?.length) return;
    if (project) return;
    const savedId = localStorage.getItem(STORAGE_KEY);
    if (savedId) {
      const found = projects.find((p) => p.id === savedId);
      if (found) setProject(found);
    }
  }, [projects, project]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const handleSelectProject = useCallback((p: Project) => {
    setProject(p);
    localStorage.setItem(STORAGE_KEY, p.id);
  }, []);

  const handleTaskOpen = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
  }, []);

  const toggleDensity = useCallback(() => {
    setDensity((prev) => (prev === "comfortable" ? "compact" : "comfortable"));
  }, []);

  return (
    <div className="app-pattern-bg min-h-screen text-foreground">
      <Header
        selectedProject={project}
        onSelectProject={handleSelectProject}
        onDeselectProject={() => {
          setProject(null);
          setSelectedTaskId(null);
          localStorage.removeItem(STORAGE_KEY);
        }}
        onOpenCommandPalette={() => setCommandOpen(true)}
        density={density}
        onDensityChange={setDensity}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      <main className={`mx-auto w-full max-w-[1680px] ${density === "compact" ? "p-4 md:p-5" : "p-6 md:p-8"}`}>
        {project ? (
          <Board
            projectId={project.id}
            onTaskClick={handleTaskOpen}
            density={density}
            viewMode={viewMode}
          />
        ) : (
          <div className="flex h-[64vh] items-center justify-center">
            <div className="w-full max-w-xl border border-border bg-card/80 p-8 text-center">
              <p className="text-base font-semibold tracking-tight">// no project selected</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Select or create a project to get started
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button size="sm" onClick={() => setCommandOpen(true)}>
                  Open command palette
                </Button>
                <Button size="sm" variant="outline" onClick={toggleDensity}>
                  Toggle density
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>

      <TaskDetail taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        projects={projects ?? []}
        tasks={projectTasks ?? []}
        selectedProjectId={project?.id ?? null}
        density={density}
        theme={theme}
        onSelectProject={handleSelectProject}
        onOpenTask={handleTaskOpen}
        onToggleTheme={toggleTheme}
        onToggleDensity={toggleDensity}
      />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
