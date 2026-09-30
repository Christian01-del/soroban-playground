import { renderHook, act } from "@testing-library/react";
import { useTransactionTracker } from "../../hooks/useTransactionTracker";

describe("useTransactionTracker", () => {
  it("returns a unique id for each addTx call", () => {
    const { result } = renderHook(() => useTransactionTracker());

    const ids = new Set<string>();
    act(() => {
      ids.add(result.current.addTx("First"));
      ids.add(result.current.addTx("Second"));
      ids.add(result.current.addTx("Third"));
    });

    expect(ids.size).toBe(3);
    expect(result.current.transactions.length).toBe(3);
  });

  it("updateTx updates the matching transaction", () => {
    const { result } = renderHook(() => useTransactionTracker());

    let id: string;
    act(() => {
      id = result.current.addTx("Pending call");
    });

    act(() => {
      result.current.updateTx(id, { status: "success", hash: "abc123" });
    });

    expect(result.current.transactions[0].status).toBe("success");
    expect(result.current.transactions[0].hash).toBe("abc123");
  });

  it("clearTx empties the transaction list", () => {
    const { result } = renderHook(() => useTransactionTracker());

    act(() => {
      result.current.addTx("First");
      result.current.addTx("Second");
    });

    expect(result.current.transactions.length).toBe(2);

    act(() => {
      result.current.clearTx();
    });

    expect(result.current.transactions.length).toBe(0);
  });
});
