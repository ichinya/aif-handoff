import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Project } from "@aif/shared/browser";
import type { TaskMetricsSummary } from "@/lib/taskMetrics";

let mockTheme = "dark";
const mockToggleTheme = vi.fn();
let mockEffectiveChatRuntime: {
  profile: {
    id: string;
    name: string;
    runtimeId: string;
    providerId: string;
    defaultModel: string | null;
    runtimeLimitSnapshot?: Record<string, unknown> | null;
    runtimeLimitUpdatedAt?: string | null;
  } | null;
} | null = null;

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    theme: mockTheme,
    toggleTheme: mockToggleTheme,
  }),
}));

vi.mock("@/hooks/useRuntimeProfiles", () => ({
  useEffectiveChatRuntime: () => ({
    data: mockEffectiveChatRuntime,
    isFetching: false,
  }),
}));

vi.mock("@/components/project/ProjectSelector", () => ({
  ProjectSelector: () => <div>Project selector</div>,
}));

vi.mock("@/components/layout/NotificationsDialog", () => ({
  NotificationsDialog: () => null,
}));

vi.mock("@/components/layout/MetricsDialog", () => ({
  MetricsDialog: () => null,
}));

vi.mock("@/components/layout/RoadmapDialog", () => ({
  RoadmapDialog: () => null,
}));

vi.mock("@/components/layout/GlobalSettingsDialog", () => ({
  GlobalSettingsDialog: () => null,
}));

const { Header } = await import("@/components/layout/Header");

const project: Project = {
  id: "project-1",
  name: "Project One",
  rootPath: "/tmp/project-1",
  plannerMaxBudgetUsd: null,
  planCheckerMaxBudgetUsd: null,
  implementerMaxBudgetUsd: null,
  reviewSidecarMaxBudgetUsd: null,
  parallelEnabled: false,
  autoQueueMode: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const metrics: TaskMetricsSummary = {
  totalTasks: 0,
  completedTasks: 0,
  verifiedTasks: 0,
  backlogTasks: 0,
  activeTasks: 0,
  blockedTasks: 0,
  autoModeTasks: 0,
  fixTasks: 0,
  totalRetries: 0,
  totalTokenInput: 0,
  totalTokenOutput: 0,
  totalTokenTotal: 0,
  averageTokensPerTask: 0,
  totalCostUsd: 0,
  averageCostPerTaskUsd: 0,
  completionRate: 0,
};

describe("Header", () => {
  beforeEach(() => {
    mockTheme = "dark";
    mockEffectiveChatRuntime = null;
    mockToggleTheme.mockClear();
  });

  it("shows runtime health badge when the effective chat runtime is near its limit", () => {
    mockEffectiveChatRuntime = {
      profile: {
        id: "profile-1",
        name: "Claude Team",
        runtimeId: "claude",
        providerId: "anthropic",
        defaultModel: "claude-sonnet",
        runtimeLimitSnapshot: {
          source: "api_headers",
          status: "warning",
          precision: "exact",
          checkedAt: "2026-04-17T00:00:00.000Z",
          providerId: "anthropic",
          runtimeId: "claude",
          profileId: "profile-1",
          primaryScope: "requests",
          resetAt: "2026-04-17T01:00:00.000Z",
          warningThreshold: 10,
          windows: [{ scope: "requests", percentRemaining: 8, warningThreshold: 10 }],
          providerMeta: null,
        },
        runtimeLimitUpdatedAt: "2026-04-17T00:00:00.000Z",
      },
    };

    render(
      <Header
        selectedProject={project}
        onSelectProject={vi.fn()}
        onDeselectProject={vi.fn()}
        onOpenCommandPalette={vi.fn()}
        density="comfortable"
        onDensityChange={vi.fn()}
        viewMode="kanban"
        onViewModeChange={vi.fn()}
        taskMetrics={metrics}
        aggregateTotals={null}
        runtimeProfilesOpen={false}
        onToggleRuntimeProfiles={vi.fn()}
      />,
    );

    expect(screen.getByText("LIMIT")).toBeDefined();
    expect(screen.getByLabelText("Runtime profiles").getAttribute("title")).toContain(
      "Request quota is at 8% remaining",
    );
  });
});
