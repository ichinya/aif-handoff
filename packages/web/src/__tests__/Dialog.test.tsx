import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

function DialogHarness() {
  const [open, setOpen] = useState(true);

  return (
    <>
      <div data-testid="state">{open ? "open" : "closed"}</div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <div data-testid="dialog-content">Dialog body</div>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("closes on Escape", () => {
    render(<DialogHarness />);

    expect(screen.getByTestId("state").textContent).toBe("open");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("state").textContent).toBe("closed");
  });

  it("closes on outside click", () => {
    render(<DialogHarness />);

    expect(screen.getByTestId("state").textContent).toBe("open");
    const overlayContainer = document.querySelector(".fixed.inset-0.flex.items-center.justify-center.p-4") as HTMLElement | null;
    expect(overlayContainer).toBeTruthy();
    fireEvent.mouseDown(overlayContainer!);
    expect(screen.getByTestId("state").textContent).toBe("closed");
  });

  it("does not close on content click", () => {
    render(<DialogHarness />);

    expect(screen.getByTestId("state").textContent).toBe("open");
    fireEvent.mouseDown(screen.getByTestId("dialog-content"));
    expect(screen.getByTestId("state").textContent).toBe("open");
  });
});
