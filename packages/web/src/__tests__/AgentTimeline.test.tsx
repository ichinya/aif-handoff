import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentTimeline } from "@/components/task/AgentTimeline";

describe("AgentTimeline", () => {
  it("shows empty state", () => {
    render(<AgentTimeline activityLog={null} />);
    expect(screen.getByText("No agent activity yet")).toBeDefined();
  });

  it("renders parsed tool entries with TOOL badge", () => {
    render(
      <AgentTimeline
        activityLog={"[2026-01-01T10:00:00.000Z] Tool: Read\n[2026-01-01T10:00:01.000Z] Tool: Write"}
      />
    );

    expect(screen.getAllByText("TOOL")).toHaveLength(2);
    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.getByText("Write")).toBeDefined();
  });

  it("renders error entries with ERROR badge", () => {
    render(
      <AgentTimeline
        activityLog={"[2026-01-01T10:00:02.000Z] Planning failed: rate limit"}
      />
    );

    expect(screen.getByText("ERROR")).toBeDefined();
    expect(screen.getByText("Planning failed: rate limit")).toBeDefined();
  });

  it("filters entries by Tools", () => {
    render(
      <AgentTimeline
        activityLog={
          "[2026-01-01T10:00:00.000Z] Tool: Read\n" +
          "[2026-01-01T10:00:01.000Z] Planning failed: rate limit\n" +
          "[2026-01-01T10:00:02.000Z] Implementation complete"
        }
      />
    );

    fireEvent.click(screen.getByText("Tools"));
    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.queryByText("Planning failed: rate limit")).toBeNull();
    expect(screen.queryByText("Implementation complete")).toBeNull();
  });

  it("filters entries by Errors", () => {
    render(
      <AgentTimeline
        activityLog={
          "[2026-01-01T10:00:00.000Z] Tool: Read\n" +
          "[2026-01-01T10:00:01.000Z] Planning failed: rate limit"
        }
      />
    );

    fireEvent.click(screen.getByText("Errors"));
    expect(screen.getByText("Planning failed: rate limit")).toBeDefined();
    expect(screen.queryByText("Read")).toBeNull();
  });
});
