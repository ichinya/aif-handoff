import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "@/components/ui/tooltip";

describe("Tooltip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders children", () => {
    render(
      <Tooltip content="Tip text">
        <button>Hover me</button>
      </Tooltip>,
    );

    expect(screen.getByText("Hover me")).toBeInTheDocument();
  });

  it("shows content on hover after delay", () => {
    render(
      <Tooltip content="Tip text">
        <button>Hover me</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByText("Hover me").parentElement!);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.getByRole("tooltip")).toHaveTextContent("Tip text");
  });

  it("hides content on mouse leave", () => {
    render(
      <Tooltip content="Tip text">
        <button>Hover me</button>
      </Tooltip>,
    );

    const trigger = screen.getByText("Hover me").parentElement!;
    fireEvent.mouseEnter(trigger);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows content on focus and hides on blur", () => {
    render(
      <Tooltip content="Tip text">
        <button>Focus me</button>
      </Tooltip>,
    );

    const trigger = screen.getByText("Focus me").parentElement!;
    fireEvent.focus(trigger);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.getByRole("tooltip")).toHaveTextContent("Tip text");

    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("merges className", () => {
    render(
      <Tooltip content="Tip" className="custom-class">
        <button>Hover</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByText("Hover").parentElement!);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.className).toContain("custom-class");
  });

  it("cancels show if mouse leaves before delay", () => {
    render(
      <Tooltip content="Tip">
        <button>Hover</button>
      </Tooltip>,
    );

    const trigger = screen.getByText("Hover").parentElement!;
    fireEvent.mouseEnter(trigger);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    fireEvent.mouseLeave(trigger);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
