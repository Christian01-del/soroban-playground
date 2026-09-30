import { render, screen, fireEvent } from "@testing-library/react";
import StorageTimeline from "../../components/StorageTimeline";

describe("StorageTimeline", () => {
  const onScrub = jest.fn();

  beforeEach(() => onScrub.mockClear());

  it("renders Ledger Timeline label", () => {
    render(
      <StorageTimeline
        totalFrames={3}
        currentFrame={0}
        onScrub={onScrub}
      />,
    );
    expect(screen.getByText(/ledger timeline/i)).toBeInTheDocument();
  });

  it("shows frame counter", () => {
    render(
      <StorageTimeline
        totalFrames={5}
        currentFrame={2}
        onScrub={onScrub}
      />,
    );
    expect(screen.getByText("Frame 3 / 5")).toBeInTheDocument();
  });

  it("shows contextLabel when provided", () => {
    render(
      <StorageTimeline
        totalFrames={2}
        currentFrame={0}
        contextLabel="My Context"
        onScrub={onScrub}
      />,
    );
    expect(screen.getByText("My Context")).toBeInTheDocument();
  });

  it("shows fallback text when no contextLabel", () => {
    render(
      <StorageTimeline totalFrames={1} currentFrame={0} onScrub={onScrub} />,
    );
    expect(screen.getByText("No snapshot selected")).toBeInTheDocument();
  });

  it("shows timestamp when capturedAt is a valid ISO date", () => {
    render(
      <StorageTimeline
        totalFrames={1}
        currentFrame={0}
        capturedAt="2026-01-01T12:00:00.000Z"
        onScrub={onScrub}
      />,
    );
    expect(screen.getByText(/captured at/i)).toBeInTheDocument();
  });

  it("shows run-prompt when capturedAt is absent", () => {
    render(
      <StorageTimeline totalFrames={0} currentFrame={0} onScrub={onScrub} />,
    );
    expect(
      screen.getByText(/run a transaction to generate/i),
    ).toBeInTheDocument();
  });

  it("previous button calls onScrub with index-1", () => {
    render(
      <StorageTimeline
        totalFrames={3}
        currentFrame={1}
        onScrub={onScrub}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /previous frame/i }));
    expect(onScrub).toHaveBeenCalledWith(0);
  });

  it("next button calls onScrub with index+1", () => {
    render(
      <StorageTimeline
        totalFrames={3}
        currentFrame={1}
        onScrub={onScrub}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /next frame/i }));
    expect(onScrub).toHaveBeenCalledWith(2);
  });

  it("previous button is disabled at frame 0", () => {
    render(
      <StorageTimeline
        totalFrames={3}
        currentFrame={0}
        onScrub={onScrub}
      />,
    );
    expect(
      screen.getByRole("button", { name: /previous frame/i }),
    ).toBeDisabled();
  });

  it("next button is disabled at last frame", () => {
    render(
      <StorageTimeline
        totalFrames={3}
        currentFrame={2}
        onScrub={onScrub}
      />,
    );
    expect(
      screen.getByRole("button", { name: /next frame/i }),
    ).toBeDisabled();
  });

  it("slider triggers onScrub when changed", () => {
    render(
      <StorageTimeline
        totalFrames={5}
        currentFrame={0}
        onScrub={onScrub}
      />,
    );
    const slider = screen.getByRole("slider", {
      name: /storage timeline slider/i,
    });
    fireEvent.change(slider, { target: { value: "3" } });
    expect(onScrub).toHaveBeenCalledWith(3);
  });

  it("renders '0 / 0' when totalFrames is 0", () => {
    render(
      <StorageTimeline totalFrames={0} currentFrame={0} onScrub={onScrub} />,
    );
    expect(screen.getByText("Frame 0 / 0")).toBeInTheDocument();
  });
});
