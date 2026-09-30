import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import OnboardingFlow from "../../components/OnboardingFlow";
import type { OnboardingStep } from "../../components/OnboardingFlow";

function steps(overrides: Partial<OnboardingStep>[] = []): OnboardingStep[] {
  const base: OnboardingStep[] = [
    { id: "wallet", title: "Connect a wallet" },
    { id: "network", title: "Choose a network" },
  ];
  return base.map((step, i) => ({ ...step, ...(overrides[i] ?? {}) }));
}

describe("OnboardingFlow", () => {
  it("renders the first step and its progress", () => {
    render(<OnboardingFlow steps={steps()} />);
    expect(screen.getByText("Connect a wallet")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
  });

  it("advances to the next step when the action resolves", async () => {
    const action = jest.fn().mockResolvedValue(undefined);
    render(<OnboardingFlow steps={steps([{ action }])} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(screen.getByText("Choose a network")).toBeInTheDocument(),
    );
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("surfaces the error and stays on the step when the action rejects", async () => {
    const action = jest.fn().mockRejectedValue(new Error("Wallet locked"));
    render(<OnboardingFlow steps={steps([{ action }])} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Wallet locked"),
    );
    expect(screen.getByText("Connect a wallet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("catches synchronous throws from a step action", async () => {
    const action = jest.fn(() => {
      throw new Error("No provider found");
    });
    render(<OnboardingFlow steps={steps([{ action }])} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("No provider found"),
    );
  });

  it("falls back to a generic message for non-Error rejections", async () => {
    const action = jest.fn().mockRejectedValue(null);
    render(<OnboardingFlow steps={steps([{ action }])} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Something went wrong",
      ),
    );
  });

  it("lets the user retry a failed step and continue once it succeeds", async () => {
    const action = jest
      .fn()
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValueOnce(undefined);
    render(<OnboardingFlow steps={steps([{ action }])} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => screen.getByRole("button", { name: "Retry" }));

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.getByText("Choose a network")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers a skip on optional steps", () => {
    render(<OnboardingFlow steps={steps([{ optional: true }])} />);
    expect(
      screen.getByRole("button", { name: "Skip this step" }),
    ).toBeInTheDocument();
  });

  it("offers a skip after a step fails twice", async () => {
    const action = jest.fn().mockRejectedValue(new Error("RPC unreachable"));
    render(<OnboardingFlow steps={steps([{ action }])} />);

    expect(
      screen.queryByRole("button", { name: "Skip this step" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Skip this step" }),
      ).toBeInTheDocument(),
    );
  });

  it("fails the step when the action exceeds the timeout", async () => {
    jest.useFakeTimers();
    try {
      const action = jest.fn(() => new Promise<void>(() => {}));
      render(
        <OnboardingFlow steps={steps([{ action }])} stepTimeoutMs={1000} />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1500);
      });

      expect(screen.getByRole("alert")).toHaveTextContent("timed out");
    } finally {
      jest.useRealTimers();
    }
  });

  it("calls onComplete after the last step", async () => {
    const onComplete = jest.fn();
    render(<OnboardingFlow steps={steps()} onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => screen.getByRole("button", { name: "Finish" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("renders a fallback instead of crashing on an empty step list", () => {
    render(<OnboardingFlow steps={[]} />);
    expect(
      screen.getByText("No onboarding steps are configured."),
    ).toBeInTheDocument();
  });
});
