import { render, screen } from "@testing-library/react";
import TransactionCallGraphComponent from "../../components/TransactionCallGraph";
import type { TransactionCallGraph } from "@/utils/transactionGraph";

describe("TransactionCallGraphComponent", () => {
  it("shows an empty state when graph has no nodes", () => {
    const emptyGraph: TransactionCallGraph = {
      nodes: [],
      edges: [],
    };

    render(
      <TransactionCallGraphComponent
        graph={emptyGraph}
        onNodeSelect={jest.fn()}
      />,
    );

    expect(
      screen.getByText(/run a contract call to visualize/i),
    ).toBeInTheDocument();
  });

  it("renders the graph when nodes are present", () => {
    const graph: TransactionCallGraph = {
      nodes: [
        {
          id: "1",
          depth: 0,
          indexInDepth: 0,
          contractId: "CABC123",
          functionName: "hello",
          argsSummary: '{"name":"World"}',
          resultSummary: "42",
          ledgerState: {},
          raw: {},
        },
      ],
      edges: [],
    };

    render(
      <TransactionCallGraphComponent graph={graph} onNodeSelect={jest.fn()} />,
    );

    expect(screen.getByText("CABC123")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
