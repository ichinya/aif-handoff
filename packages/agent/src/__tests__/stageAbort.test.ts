import { describe, it, expect } from "vitest";
import { getActiveStageAbortController, setActiveStageAbortController } from "../stageAbort.js";

describe("stageAbort", () => {
  it("returns null when no controller is set", () => {
    setActiveStageAbortController(null);
    expect(getActiveStageAbortController()).toBeNull();
  });

  it("stores and retrieves an AbortController", () => {
    const abort = new AbortController();
    setActiveStageAbortController(abort);
    expect(getActiveStageAbortController()).toBe(abort);
    setActiveStageAbortController(null);
  });

  it("can abort the stored controller", () => {
    const abort = new AbortController();
    setActiveStageAbortController(abort);
    expect(abort.signal.aborted).toBe(false);

    abort.abort();
    expect(abort.signal.aborted).toBe(true);
    setActiveStageAbortController(null);
  });
});
