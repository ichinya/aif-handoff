import { useCallback, useState } from "react";
import { Bell, Moon, Sun, Command } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import {
  getDesktopNotificationPermission,
  requestDesktopNotificationPermission,
  useNotificationSettings,
} from "@/hooks/useNotificationSettings";
import { ProjectSelector } from "@/components/project/ProjectSelector";
import type { Project } from "@aif/shared/browser";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  selectedProject: Project | null;
  onSelectProject: (project: Project) => void;
  onDeselectProject: () => void;
  onOpenCommandPalette: () => void;
  density: "comfortable" | "compact";
  onDensityChange: (density: "comfortable" | "compact") => void;
  viewMode: "kanban" | "list";
  onViewModeChange: (mode: "kanban" | "list") => void;
}

export function Header({
  selectedProject,
  onSelectProject,
  onDeselectProject,
  onOpenCommandPalette,
  density,
  onDensityChange,
  viewMode,
  onViewModeChange,
}: Props) {
  const { theme, toggleTheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { settings, setSettings } = useNotificationSettings();
  const permission = getDesktopNotificationPermission();
  const isCompact = density === "compact";

  const handleDesktopNotificationsToggle = useCallback(async () => {
    const next = !settings.desktop;
    if (!next) {
      setSettings({ desktop: false });
      return;
    }

    const result = await requestDesktopNotificationPermission();
    if (result === "granted") {
      setSettings({ desktop: true });
      return;
    }

    setSettings({ desktop: false });
  }, [setSettings, settings.desktop]);

  const handleSoundToggle = useCallback(() => {
    setSettings({ sound: !settings.sound });
  }, [setSettings, settings.sound]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/65">
      <div className={`mx-auto flex w-full max-w-[1680px] items-center ${isCompact ? "h-14 px-4 md:px-5" : "h-16 px-6 md:px-8"}`}>
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold tracking-tight text-primary">&gt;</span>
          <div className="h-5 w-px bg-border" />
          <ProjectSelector
            selectedId={selectedProject?.id ?? null}
            onSelect={onSelectProject}
            onDeselect={onDeselectProject}
          />
        </div>

        <div className="ml-auto flex items-center gap-2.5">
          <button
            onClick={onOpenCommandPalette}
            className="hidden h-8 items-center gap-1 border border-border bg-card px-2 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/70 hover:text-foreground md:inline-flex"
            aria-label="Open command palette"
            type="button"
          >
            <Command className="h-3.5 w-3.5" />
            K
          </button>

          <div className="hidden h-8 border border-border bg-card md:flex">
            <button
              onClick={() => onViewModeChange("kanban")}
              className={`h-full px-2 text-[10px] font-mono transition-colors ${
                viewMode === "kanban"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-accent"
              }`}
              type="button"
            >
              KANBAN
            </button>
            <button
              onClick={() => onViewModeChange("list")}
              className={`h-full border-l border-border px-2 text-[10px] font-mono transition-colors ${
                viewMode === "list"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-accent"
              }`}
              type="button"
            >
              LIST
            </button>
          </div>

          <div className="hidden h-8 border border-border bg-card md:flex">
            <button
              onClick={() => onDensityChange("comfortable")}
              className={`h-full px-2 text-[10px] font-mono transition-colors ${
                density === "comfortable"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-accent"
              }`}
              type="button"
            >
              COMFY
            </button>
            <button
              onClick={() => onDensityChange("compact")}
              className={`h-full border-l border-border px-2 text-[10px] font-mono transition-colors ${
                density === "compact"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-accent"
              }`}
              type="button"
            >
              COMPACT
            </button>
          </div>

          <button
            onClick={toggleTheme}
            className="inline-flex h-8 w-8 items-center justify-center border border-border bg-card text-foreground transition-colors hover:border-primary/70 hover:bg-accent"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="inline-flex h-8 w-8 items-center justify-center border border-border bg-card text-foreground transition-colors hover:border-primary/70 hover:bg-accent"
            aria-label="Notification settings"
          >
            <Bell className="h-4 w-4" />
          </button>
        </div>
      </div>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogClose onClose={() => setSettingsOpen(false)} />
          <DialogHeader>
            <DialogTitle>Notifications</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between border border-border bg-card/50 px-3 py-2">
              <div>
                <p className="text-sm font-medium">Desktop notifications</p>
                <p className="text-xs text-muted-foreground">
                  Browser and OS alerts when a task changes status
                </p>
              </div>
              <button
                onClick={() => void handleDesktopNotificationsToggle()}
                className="min-w-16 border border-border bg-background px-2 py-1 text-xs transition-colors hover:border-primary/70"
              >
                {settings.desktop ? "ON" : "OFF"}
              </button>
            </div>

            <div className="flex items-center justify-between border border-border bg-card/50 px-3 py-2">
              <div>
                <p className="text-sm font-medium">Sound</p>
                <p className="text-xs text-muted-foreground">
                  Play a short sound on task status change
                </p>
              </div>
              <button
                onClick={handleSoundToggle}
                className="min-w-16 border border-border bg-background px-2 py-1 text-xs transition-colors hover:border-primary/70"
              >
                {settings.sound ? "ON" : "OFF"}
              </button>
            </div>

            {permission === "unsupported" && (
              <p className="text-xs text-amber-400">
                This browser does not support desktop notifications.
              </p>
            )}
            {permission === "denied" && (
              <p className="text-xs text-amber-400">
                Desktop notifications are blocked in browser settings.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
