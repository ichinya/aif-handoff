import { useEffect, useRef, useState } from "react";
import { FolderOpen, Plus, ChevronDown, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useProjects, useCreateProject, useUpdateProject, useDeleteProject } from "@/hooks/useProjects";
import type { Project } from "@aif/shared/browser";

interface Props {
  selectedId: string | null;
  onSelect: (project: Project) => void;
  onDeselect: () => void;
}

type DialogMode = "create" | "edit";

export function ProjectSelector({ selectedId, onSelect, onDeselect }: Props) {
  const { data: projects } = useProjects();
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const selectorRef = useRef<HTMLDivElement>(null);

  const selected = projects?.find((p) => p.id === selectedId);

  const openCreate = () => {
    setDialogMode("create");
    setEditingId(null);
    setName("");
    setRootPath("");
    setDropdownOpen(false);
    setDialogOpen(true);
  };

  const openEdit = (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setDialogMode("edit");
    setEditingId(p.id);
    setName(p.name);
    setRootPath(p.rootPath);
    setDropdownOpen(false);
    setDialogOpen(true);
  };

  const handleDelete = (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete project "${p.name}"?`)) return;
    deleteProject.mutate(p.id, {
      onSuccess: () => {
        if (selectedId === p.id) onDeselect();
      },
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !rootPath.trim()) return;

    if (dialogMode === "create") {
      createProject.mutate(
        { name: name.trim(), rootPath: rootPath.trim() },
        {
          onSuccess: (project) => {
            onSelect(project);
            setDialogOpen(false);
          },
        }
      );
    } else if (editingId) {
      updateProject.mutate(
        { id: editingId, input: { name: name.trim(), rootPath: rootPath.trim() } },
        {
          onSuccess: (project) => {
            if (selectedId === editingId) onSelect(project);
            setDialogOpen(false);
          },
        }
      );
    }
  };

  const isPending = createProject.isPending || updateProject.isPending;

  useEffect(() => {
    if (!dropdownOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (selectorRef.current?.contains(target)) return;
      setDropdownOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDropdownOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dropdownOpen]);

  return (
    <>
      <div className="relative" ref={selectorRef}>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-border bg-card/80 hover:bg-accent/60"
          onClick={() => setDropdownOpen(!dropdownOpen)}
        >
          <FolderOpen className="h-4 w-4" />
          {selected?.name ?? "Select project"}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>

        {dropdownOpen && (
          <div className="absolute left-0 top-full z-50 mt-2 min-w-[280px] border border-border bg-popover p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.45)]">
            {projects?.map((p) => (
              <div
                key={p.id}
                className={`group flex items-center gap-1 text-sm hover:bg-accent ${
                  p.id === selectedId ? "bg-accent" : ""
                }`}
              >
                <button
                  className="flex-1 px-3 py-2 text-left"
                  onClick={() => {
                    onSelect(p);
                    setDropdownOpen(false);
                  }}
                >
                  <div className="font-medium tracking-tight">{p.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {p.rootPath}
                  </div>
                </button>
                <button
                  className="p-1.5 opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100"
                  onClick={(e) => openEdit(p, e)}
                  title="Edit"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  className="p-1.5 text-destructive opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100"
                  onClick={(e) => handleDelete(p, e)}
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}

            {projects?.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                // no projects yet
              </div>
            )}

            <div className="mt-1 border-t border-border pt-1">
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={openCreate}
              >
                <Plus className="h-3 w-3" />
                New project
              </button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogClose onClose={() => setDialogOpen(false)} />
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "create" ? "Create Project" : "Edit Project"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                placeholder="My Project"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium">Root Path</label>
              <Input
                placeholder="/Users/me/projects/my-project"
                value={rootPath}
                onChange={(e) => setRootPath(e.target.value)}
                className="font-mono text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Absolute path where agents will create files
              </p>
            </div>
            <Button
              type="submit"
              disabled={!name.trim() || !rootPath.trim() || isPending}
            >
              {isPending
                ? dialogMode === "create"
                  ? "Creating..."
                  : "Saving..."
                : dialogMode === "create"
                  ? "Create"
                  : "Save"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
