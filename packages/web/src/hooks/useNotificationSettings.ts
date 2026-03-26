import { useCallback, useMemo, useSyncExternalStore } from "react";

export interface NotificationSettings {
  desktop: boolean;
  sound: boolean;
}

const STORAGE_KEY = "aif-notification-settings";

const DEFAULT_SETTINGS: NotificationSettings = {
  desktop: false,
  sound: false,
};

function getSettings(): NotificationSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_SETTINGS;

  try {
    const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
    return {
      desktop: Boolean(parsed.desktop),
      sound: Boolean(parsed.sound),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const listeners = new Set<() => void>();
let cachedSettings = getSettings();
let cachedSnapshot = JSON.stringify(cachedSettings);

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return cachedSnapshot;
}

export function requestDesktopNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return Promise.resolve("unsupported");
  }
  return Notification.requestPermission();
}

export function getDesktopNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission;
}

export function useNotificationSettings() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const settings = useMemo(() => {
    try {
      return JSON.parse(snapshot) as NotificationSettings;
    } catch {
      return DEFAULT_SETTINGS;
    }
  }, [snapshot]);

  const setSettings = useCallback((partial: Partial<NotificationSettings>) => {
    const next: NotificationSettings = { ...cachedSettings, ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    cachedSettings = next;
    cachedSnapshot = JSON.stringify(next);
    listeners.forEach((cb) => cb());
  }, []);

  return { settings, setSettings };
}
