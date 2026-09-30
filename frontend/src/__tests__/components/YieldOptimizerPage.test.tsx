import { fireEvent, render, screen } from "@testing-library/react";
import YieldOptimizerPage from "../../app/yield-optimizer/page";
import YieldOptimizerPanel from "../../components/YieldOptimizerPanel";

jest.mock("../../components/YieldOptimizerPanel", () => ({
  __esModule: true,
  default: jest.fn(
    ({
      contractId,
      walletAddress,
    }: {
      contractId: string;
      walletAddress: string;
    }) => (
      <div data-testid="yield-optimizer-panel">
        {contractId} / {walletAddress}
      </div>
    ),
  ),
}));

describe("YieldOptimizerPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NEXT_PUBLIC_YIELD_OPTIMIZER_CONTRACT_ID;
  });

  it("renders the connection settings form and empty state by default", () => {
    render(<YieldOptimizerPage />);

    expect(
      screen.getByRole("heading", { name: /yield optimizer/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/connection/i)).toBeInTheDocument();
    expect(
      screen.getByText("Enter a contract ID above to get started."),
    ).toBeInTheDocument();
  });

  it("shows a validation error for invalid contract identifiers", () => {
    render(<YieldOptimizerPage />);

    fireEvent.change(screen.getByLabelText(/contract id/i), {
      target: { value: "invalid-id" },
    });
    fireEvent.change(screen.getByLabelText(/wallet address/i), {
      target: { value: "GDEMOWALLET000000000000000000000000000000000" },
    });

    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    expect(
      screen.getByText("Contract ID must start with C and be 56 characters."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("yield-optimizer-panel"),
    ).not.toBeInTheDocument();
  });

  it("renders the panel when a valid contract id is submitted", () => {
    render(<YieldOptimizerPage />);

    fireEvent.change(screen.getByLabelText(/contract id/i), {
      target: { value: "C".repeat(56) },
    });
    fireEvent.change(screen.getByLabelText(/wallet address/i), {
      target: { value: "GDEMOWALLET000000000000000000000000000000000" },
    });

    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    expect(screen.getByTestId("yield-optimizer-panel")).toBeInTheDocument();
    expect(YieldOptimizerPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: "C".repeat(56),
        walletAddress: "GDEMOWALLET000000000000000000000000000000000",
      }),
      undefined,
    );
  });
});
