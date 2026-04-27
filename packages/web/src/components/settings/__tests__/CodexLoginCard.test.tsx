import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CodexLoginCard } from "../CodexLoginCard";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    status: number;
    data?: unknown;
    constructor(message: string, status: number, data?: unknown) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    api: {
      getCodexLoginCapabilities: vi.fn(),
      getCodexLoginStatus: vi.fn(),
      startCodexLogin: vi.fn(),
      cancelCodexLogin: vi.fn(),
    },
  };
});

function renderCard(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CodexLoginCard />
    </QueryClientProvider>,
  );
}

describe("CodexLoginCard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (api.getCodexLoginCapabilities as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      loginProxyEnabled: true,
    });
    (api.getCodexLoginStatus as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      active: false,
    });
  });

  it("renders initial idle state with a Start button", () => {
    renderCard();
    expect(screen.getByText(/Codex OAuth login/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start Codex login/i })).toBeInTheDocument();
  });

  it("displays the verification URL and one-time code after Start", async () => {
    (api.startCodexLogin as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: "s-1",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-12345",
      startedAt: new Date().toISOString(),
    });

    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Start Codex login/i }));

    await waitFor(() => expect(screen.getByText("ABCD-12345")).toBeInTheDocument());
    expect(screen.getByText("https://auth.openai.com/codex/device")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open verification page/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy code/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel/i })).toBeInTheDocument();
  });

  it("flips to success when the broker reports the session is no longer active", async () => {
    const statusMock = api.getCodexLoginStatus as unknown as ReturnType<typeof vi.fn>;
    statusMock.mockResolvedValue({
      active: true,
      sessionId: "s-1",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-12345",
      startedAt: new Date().toISOString(),
    });
    (api.startCodexLogin as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: "s-1",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-12345",
      startedAt: new Date().toISOString(),
    });

    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Start Codex login/i }));
    await waitFor(() => expect(screen.getByText("ABCD-12345")).toBeInTheDocument());

    // Simulate the child exiting in the broker — status query now returns inactive.
    statusMock.mockResolvedValue({ active: false });

    await waitFor(
      () => expect(screen.getByText(/Codex is now authenticated/i)).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it("shows an error message when start fails", async () => {
    (api.startCodexLogin as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("broker_unreachable"),
    );
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Start Codex login/i }));
    await waitFor(() => expect(screen.getByText(/broker_unreachable/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
  });
});
