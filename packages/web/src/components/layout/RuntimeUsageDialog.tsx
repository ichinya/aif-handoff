import { useMemo } from "react";
import type {
  RuntimeLimitSnapshot,
  RuntimeLimitWindow,
  RuntimeProfile,
  RuntimeProfileUsage,
} from "@aif/shared/browser";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRuntimeProfiles } from "@/hooks/useRuntimeProfiles";
import { getRuntimeLimitDisplay, runtimeLimitBadgeClassName } from "@/lib/runtimeLimits";

interface RuntimeUsageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
}

interface RuntimeUsageEntry {
  key: string;
  runtimeId: string;
  providerId: string;
  transport: string | null;
  baseUrl: string | null;
  defaultModel: string | null;
  profileNames: string[];
  snapshot: RuntimeLimitSnapshot | null;
  snapshotUpdatedAt: string | null;
  lastUsage: RuntimeProfileUsage | null;
  lastUsageAt: string | null;
}

const NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function toFiniteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatPercent(value: number): string {
  const rounded = value >= 10 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  return `${rounded}%`;
}

function formatQuantity(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mapWindowName(name: string | null | undefined): string | null {
  switch (name) {
    case "five_hour":
      return "5h";
    case "seven_day":
      return "7d";
    case "seven_day_opus":
      return "7d Opus";
    case "seven_day_sonnet":
      return "7d Sonnet";
    case "overage":
      return "Overage";
    default:
      return typeof name === "string" && name.trim().length > 0 ? name.replace(/_/g, " ") : null;
  }
}

function scopeLabel(scope: RuntimeLimitWindow["scope"]): string {
  switch (scope) {
    case "requests":
      return "Requests";
    case "tokens":
      return "Tokens";
    case "time":
      return "Window";
    case "spend":
      return "Spend";
    case "turn_usage":
      return "Turn usage";
    case "model_usage":
      return "Model usage";
    case "tool_usage":
      return "Tool usage";
    default:
      return "Runtime quota";
  }
}

function windowLabel(window: RuntimeLimitWindow): string {
  return mapWindowName(window.name ?? null) ?? scopeLabel(window.scope);
}

function windowSummary(window: RuntimeLimitWindow): string {
  const percentRemaining = toFiniteNumber(window.percentRemaining);
  const percentUsed = toFiniteNumber(window.percentUsed);
  const remaining = toFiniteNumber(window.remaining);
  const limit = toFiniteNumber(window.limit);
  const used = toFiniteNumber(window.used);

  if (percentRemaining != null) {
    return `${formatPercent(percentRemaining)} remaining`;
  }
  if (remaining != null && limit != null) {
    return `${formatQuantity(remaining)} of ${formatQuantity(limit)} remaining`;
  }
  if (remaining != null) {
    return `${formatQuantity(remaining)} remaining`;
  }
  if (used != null && limit != null) {
    return `${formatQuantity(used)} of ${formatQuantity(limit)} used`;
  }
  if (percentUsed != null) {
    return `${formatPercent(percentUsed)} used`;
  }
  return "No detailed quota signal";
}

function windowResetText(
  window: RuntimeLimitWindow,
  snapshot: RuntimeLimitSnapshot | null,
): string | null {
  const resetLabel = formatTimestamp(window.resetAt ?? snapshot?.resetAt ?? null);
  if (resetLabel) {
    return `Resets ${resetLabel}`;
  }

  const retryAfterSeconds = window.retryAfterSeconds ?? snapshot?.retryAfterSeconds ?? null;
  if (typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds)) {
    return `Retry after ${Math.max(0, Math.round(retryAfterSeconds))}s`;
  }

  return null;
}

function latestLimitUpdatedAt(profile: RuntimeProfile): string | null {
  return profile.runtimeLimitUpdatedAt ?? profile.runtimeLimitSnapshot?.checkedAt ?? null;
}

function latestUsageUpdatedAt(profile: RuntimeProfile): string | null {
  return profile.lastUsageAt ?? null;
}

function updatedAtMs(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function usageDetailRows(usage: RuntimeProfileUsage): Array<{ label: string; value: string }> {
  const rows = [
    { label: "Input", value: formatQuantity(usage.inputTokens) },
    { label: "Output", value: formatQuantity(usage.outputTokens) },
    { label: "Total", value: formatQuantity(usage.totalTokens) },
  ];

  if (typeof usage.costUsd === "number" && Number.isFinite(usage.costUsd)) {
    rows.push({
      label: "Cost",
      value: `$${usage.costUsd < 0.01 ? usage.costUsd.toFixed(4) : usage.costUsd.toFixed(2)}`,
    });
  }

  return rows;
}

function buildRuntimeUsageEntries(profiles: RuntimeProfile[]): RuntimeUsageEntry[] {
  const grouped = new Map<string, RuntimeUsageEntry>();

  for (const profile of profiles) {
    if (!profile.enabled) continue;

    const key = [
      profile.runtimeId,
      profile.providerId,
      profile.transport ?? "",
      profile.baseUrl ?? "",
      profile.defaultModel ?? "",
    ].join("|");
    const profileLimitUpdatedAt = latestLimitUpdatedAt(profile);
    const profileUsageUpdatedAt = latestUsageUpdatedAt(profile);
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        key,
        runtimeId: profile.runtimeId,
        providerId: profile.providerId,
        transport: profile.transport ?? null,
        baseUrl: profile.baseUrl ?? null,
        defaultModel: profile.defaultModel ?? null,
        profileNames: [profile.name],
        snapshot: profile.runtimeLimitSnapshot ?? null,
        snapshotUpdatedAt: profileLimitUpdatedAt,
        lastUsage: profile.lastUsage ?? null,
        lastUsageAt: profileUsageUpdatedAt,
      });
      continue;
    }

    if (!existing.profileNames.includes(profile.name)) {
      existing.profileNames.push(profile.name);
    }

    if (updatedAtMs(profileLimitUpdatedAt) > updatedAtMs(existing.snapshotUpdatedAt)) {
      existing.snapshot = profile.runtimeLimitSnapshot ?? null;
      existing.snapshotUpdatedAt = profileLimitUpdatedAt;
      existing.transport = profile.transport ?? null;
      existing.baseUrl = profile.baseUrl ?? null;
      existing.defaultModel = profile.defaultModel ?? null;
    }

    if (updatedAtMs(profileUsageUpdatedAt) > updatedAtMs(existing.lastUsageAt)) {
      existing.lastUsage = profile.lastUsage ?? null;
      existing.lastUsageAt = profileUsageUpdatedAt;
      existing.transport = profile.transport ?? null;
      existing.baseUrl = profile.baseUrl ?? null;
      existing.defaultModel = profile.defaultModel ?? null;
    }
  }

  return Array.from(grouped.values()).sort((left, right) => {
    return `${left.runtimeId}/${left.providerId}/${left.defaultModel ?? ""}`.localeCompare(
      `${right.runtimeId}/${right.providerId}/${right.defaultModel ?? ""}`,
    );
  });
}

export function RuntimeUsageDialog({ open, onOpenChange, projectId }: RuntimeUsageDialogProps) {
  const { data: profiles = [], isLoading } = useRuntimeProfiles(projectId, true);

  const entries = useMemo(() => buildRuntimeUsageEntries(profiles), [profiles]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogClose onClose={() => onOpenChange(false)} />
        <DialogHeader>
          <DialogTitle>Runtime Usage</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Last known quota windows and recorded usage across configured runtimes. Some transports
            expose live quota state, while others only report per-run token usage.
          </p>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading runtime usage…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No enabled runtime profiles configured.</p>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => {
              const limitDisplay = getRuntimeLimitDisplay(entry.snapshot, {
                checkedAt: entry.snapshotUpdatedAt,
              });
              const quotaUpdatedLabel = formatTimestamp(entry.snapshotUpdatedAt);
              const usageUpdatedLabel = formatTimestamp(entry.lastUsageAt);
              const windowList = entry.snapshot?.windows ?? [];
              const usageRows = entry.lastUsage ? usageDetailRows(entry.lastUsage) : [];

              return (
                <div key={entry.key} className="border border-border bg-background/40 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold">
                          {entry.runtimeId}/{entry.providerId}
                        </span>
                        {limitDisplay ? (
                          <Badge
                            size="sm"
                            className={runtimeLimitBadgeClassName(limitDisplay.tone)}
                          >
                            {limitDisplay.label.toUpperCase()}
                          </Badge>
                        ) : (
                          <Badge
                            size="sm"
                            className="border-border bg-secondary/60 text-muted-foreground"
                          >
                            {entry.lastUsage ? "USAGE ONLY" : "NO SIGNAL"}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>Model: {entry.defaultModel ?? "auto"}</span>
                        <span>Transport: {entry.transport ?? "default"}</span>
                        {entry.baseUrl ? <span>Custom endpoint</span> : null}
                        <span>
                          {entry.profileNames.length > 1 ? "Profiles" : "Profile"}:{" "}
                          {entry.profileNames.join(", ")}
                        </span>
                      </div>
                    </div>
                    <div className="text-right text-[11px] text-muted-foreground">
                      <div>
                        {quotaUpdatedLabel ? `Quota ${quotaUpdatedLabel}` : "Quota not updated yet"}
                      </div>
                      <div>
                        {usageUpdatedLabel ? `Usage ${usageUpdatedLabel}` : "Usage not updated yet"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div className="border border-border/70 bg-card/60 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Quota
                        </p>
                        <span className="text-[11px] text-muted-foreground">
                          {quotaUpdatedLabel ? `Updated ${quotaUpdatedLabel}` : "No update yet"}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {limitDisplay?.summary ??
                          "No live quota window reported for this runtime/transport yet."}
                      </p>

                      {windowList.length > 0 ? (
                        <div className="mt-3 space-y-1">
                          {windowList.map((window, index) => {
                            const resetText = windowResetText(window, entry.snapshot);
                            return (
                              <div
                                key={`${entry.key}:${window.scope}:${window.name ?? index}`}
                                className="flex flex-wrap items-start justify-between gap-2 border border-border/70 bg-background/50 px-2 py-1.5"
                              >
                                <div className="min-w-0">
                                  <p className="text-xs font-medium">{windowLabel(window)}</p>
                                  <p className="text-[11px] text-muted-foreground">
                                    {windowSummary(window)}
                                  </p>
                                </div>
                                <div className="text-right text-[11px] text-muted-foreground">
                                  {resetText ?? "No reset time reported"}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mt-3 border border-border/70 bg-background/50 px-2 py-1.5 text-[11px] text-muted-foreground">
                          Provider did not expose per-window quota details for this runtime.
                        </div>
                      )}
                    </div>

                    <div className="border border-border/70 bg-card/60 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Last Usage
                        </p>
                        <span className="text-[11px] text-muted-foreground">
                          {usageUpdatedLabel ? `Updated ${usageUpdatedLabel}` : "No update yet"}
                        </span>
                      </div>

                      {entry.lastUsage ? (
                        <div className="mt-3 grid gap-1 sm:grid-cols-2">
                          {usageRows.map((row) => (
                            <div
                              key={`${entry.key}:usage:${row.label}`}
                              className="border border-border/70 bg-background/50 px-2 py-1.5"
                            >
                              <p className="text-[11px] text-muted-foreground">{row.label}</p>
                              <p className="text-sm font-medium">{row.value}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 border border-border/70 bg-background/50 px-2 py-1.5 text-[11px] text-muted-foreground">
                          No recorded usage for this runtime profile yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
