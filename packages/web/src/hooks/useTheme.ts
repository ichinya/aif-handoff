import { useCallback, useSyncExternalStore } from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "aif-theme";

function getTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return (localStorage.getItem(STORAGE_KEY) as Theme) || "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("light", theme === "light");
}

// Initialize on load
if (typeof window !== "undefined") {
  applyTheme(getTheme());
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): Theme {
  return getTheme();
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot);

  const toggleTheme = useCallback(() => {
    const next: Theme = getTheme() === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    listeners.forEach((cb) => cb());
  }, []);

  return { theme, toggleTheme };
}
