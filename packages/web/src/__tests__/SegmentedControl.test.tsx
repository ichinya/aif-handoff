import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SegmentedControl } from "@/components/ui/segmented-control";

const items = [
  { value: "board", label: "Board" },
  { value: "list", label: "List" },
  { value: "timeline", label: "Timeline" },
];

describe("SegmentedControl", () => {
  it("renders all items", () => {
    render(<SegmentedControl items={items} value="board" onValueChange={vi.fn()} />);
    expect(screen.getByText("Board")).toBeTruthy();
    expect(screen.getByText("List")).toBeTruthy();
    expect(screen.getByText("Timeline")).toBeTruthy();
  });

  it("highlights active item", () => {
    render(<SegmentedControl items={items} value="list" onValueChange={vi.fn()} />);
    const listButton = screen.getByText("List").closest("button")!;
    const boardButton = screen.getByText("Board").closest("button")!;
    expect(listButton.className).toContain("bg-primary/15");
    expect(listButton.className).toContain("text-primary");
    expect(boardButton.className).toContain("text-muted-foreground");
  });

  it("fires onValueChange on click", () => {
    const onChange = vi.fn();
    render(<SegmentedControl items={items} value="board" onValueChange={onChange} />);
    fireEvent.click(screen.getByText("Timeline"));
    expect(onChange).toHaveBeenCalledWith("timeline");
  });

  it("merges className", () => {
    const { container } = render(
      <SegmentedControl
        items={items}
        value="board"
        onValueChange={vi.fn()}
        className="my-custom"
      />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("my-custom");
    expect(root.className).toContain("inline-flex");
  });

  it("renders icon when provided", () => {
    const itemsWithIcon = [
      { value: "a", label: "Alpha", icon: <span data-testid="icon-alpha">IC</span> },
      { value: "b", label: "Beta" },
    ];
    render(<SegmentedControl items={itemsWithIcon} value="a" onValueChange={vi.fn()} />);
    expect(screen.getByTestId("icon-alpha")).toBeTruthy();
  });
});
