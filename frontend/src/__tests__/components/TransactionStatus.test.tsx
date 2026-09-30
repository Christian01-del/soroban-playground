import { render, screen, fireEvent } from "@testing-library/react";
import TransactionStatus from "../../components/TransactionStatus";
import type { Transaction } from "@/hooks/useTransactionTracker";

describe("TransactionStatus", () => {
  const emptyProps = {
    transactions: [] as Transaction[],
    onClear: jest.fn(),
  };

  it("returns null when there are no transactions", () => {
    const { container } = render(<TransactionStatus {...emptyProps} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders a list of transactions", () => {
    const transactions: Transaction[] = [
      {
        id: "tx-1",
        label: "hello",
        status: "success",
        hash: "abc123",
        timestamp: Date.now(),
      },
      {
        id: "tx-2",
        label: "doom",
        status: "error",
        error: "insufficient balance",
        timestamp: Date.now() - 1000,
      },
    ];

    render(
      <TransactionStatus transactions={transactions} onClear={jest.fn()} />,
    );

    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("View on Explorer")).toBeInTheDocument();
    expect(screen.getByText("insufficient balance")).toBeInTheDocument();
  });

  it("calls onClear when the clear button is clicked", () => {
    const onClear = jest.fn();
    render(
      <TransactionStatus
        transactions={[
          {
            id: "tx-1",
            label: "hello",
            status: "success",
            timestamp: Date.now(),
          },
        ]}
        onClear={onClear}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /clear transactions/i }),
    );
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
