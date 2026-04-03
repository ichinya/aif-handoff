import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Popover } from "@/components/ui/popover";
import { Dialog, DialogContent } from "@/components/ui/dialog";

function PopoverHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div data-testid="state">{open ? "open" : "closed"}</div>
      <Popover open={open} onOpenChange={setOpen} content={<div>Popover body</div>}>
        <button data-testid="trigger">Open</button>
      </Popover>
    </>
  );
}

function StackedOverlayHarness() {
  const [popoverOpen, setPopoverOpen] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(true);

  return (
    <>
      <div data-testid="popover-state">{popoverOpen ? "open" : "closed"}</div>
      <div data-testid="dialog-state">{dialogOpen ? "open" : "closed"}</div>

      <Popover open={popoverOpen} onOpenChange={setPopoverOpen} content={<div>Popover body</div>}>
        <button>Trigger</button>
      </Popover>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <div>Dialog body</div>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe("Popover", () => {
  it("renders trigger", () => {
    render(<PopoverHarness />);
    expect(screen.getByTestId("trigger")).toBeInTheDocument();
  });

  it("opens on click", () => {
    render(<PopoverHarness />);

    expect(screen.getByTestId("state").textContent).toBe("closed");
    fireEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByTestId("state").textContent).toBe("open");
    expect(screen.getByText("Popover body")).toBeInTheDocument();
  });

  it("closes on ESC", () => {
    render(<PopoverHarness />);

    fireEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByTestId("state").textContent).toBe("open");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("state").textContent).toBe("closed");
  });

  it("closes on outside click", () => {
    render(<PopoverHarness />);

    fireEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByTestId("state").textContent).toBe("open");

    fireEvent.mouseDown(document.body);
    expect(screen.getByTestId("state").textContent).toBe("closed");
  });

  it("does not close when clicking inside popover content", () => {
    render(<PopoverHarness />);

    fireEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByTestId("state").textContent).toBe("open");

    fireEvent.mouseDown(screen.getByText("Popover body"));
    expect(screen.getByTestId("state").textContent).toBe("open");
  });

  it("respects overlay stack — ESC closes only top layer", () => {
    render(<StackedOverlayHarness />);

    expect(screen.getByTestId("popover-state").textContent).toBe("open");
    expect(screen.getByTestId("dialog-state").textContent).toBe("open");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("dialog-state").textContent).toBe("closed");
    expect(screen.getByTestId("popover-state").textContent).toBe("open");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("popover-state").textContent).toBe("closed");
  });
});
