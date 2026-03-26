import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mutateCreateTask = vi.fn();

vi.mock("@/hooks/useTasks", () => ({
  useCreateTask: () => ({
    mutate: mutateCreateTask,
    isPending: false,
  }),
}));

const { AddTaskForm } = await import("@/components/kanban/AddTaskForm");

describe("AddTaskForm", () => {
  beforeEach(() => {
    mutateCreateTask.mockClear();
  });

  it("uses autoMode=true by default", () => {
    render(<AddTaskForm projectId="p-1" />);

    fireEvent.click(screen.getByText("Add task"));
    fireEvent.change(screen.getByPlaceholderText("Task title"), {
      target: { value: "Task with auto mode" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(mutateCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p-1",
        title: "Task with auto mode",
        autoMode: true,
      }),
      expect.any(Object)
    );
  });

  it("submits autoMode=false when checkbox is unchecked", () => {
    render(<AddTaskForm projectId="p-1" />);

    fireEvent.click(screen.getByText("Add task"));
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    fireEvent.change(screen.getByPlaceholderText("Task title"), {
      target: { value: "Task manual mode" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(mutateCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p-1",
        title: "Task manual mode",
        autoMode: false,
      }),
      expect.any(Object)
    );
  });

  it("resets and closes form on cancel", () => {
    const { container } = render(<AddTaskForm projectId="p-1" />);

    fireEvent.click(screen.getByText("Add task"));
    fireEvent.change(screen.getByPlaceholderText("Task title"), {
      target: { value: "Will be cleared" },
    });
    fireEvent.change(screen.getByPlaceholderText("Description (optional)"), {
      target: { value: "Temp text" },
    });

    const cancelButton = container.querySelector('button[type="button"]') as HTMLButtonElement;
    fireEvent.click(cancelButton);

    expect(screen.getByText("Add task")).toBeDefined();
    expect(screen.queryByPlaceholderText("Task title")).toBeNull();
  });

  it("runs submit onSuccess callback and closes form", async () => {
    render(<AddTaskForm projectId="p-1" />);

    fireEvent.click(screen.getByText("Add task"));
    fireEvent.change(screen.getByPlaceholderText("Task title"), {
      target: { value: "Success task" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const options = mutateCreateTask.mock.calls[0][1] as { onSuccess?: () => void };
    await act(async () => {
      options.onSuccess?.();
    });

    await waitFor(() => {
      expect(screen.getByText("Add task")).toBeDefined();
      expect(screen.queryByPlaceholderText("Task title")).toBeNull();
    });
  });
});
