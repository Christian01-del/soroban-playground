import React from "react";
import { render, screen } from "@testing-library/react";
import { EventsPanel } from "@/components/EventsPanel";

jest.mock("@/hooks/useEventStream", () => ({
  useEventStream: () => ({
    events: [
      {
        id: "evt-1",
        type: "event",
        event_type: "transfer",
        contract_id: "CC1234567890ABCDEF",
        ledger: 100,
        ledger_closed_at: new Date().toISOString(),
        data: JSON.stringify({ amount: "1000", to: "G123" }),
      },
    ],
    status: "connected",
    droppedCount: 0,
    clearEvents: jest.fn(),
    reconnect: jest.fn(),
  }),
}));

describe("EventsPanel", () => {
  it("renders live events title and event badge", () => {
    render(<EventsPanel wsUrl="ws://localhost:3001/ws/events" />);
    expect(screen.getByText("Live Events")).toBeInTheDocument();
    expect(screen.getByText("transfer")).toBeInTheDocument();
  });
});
