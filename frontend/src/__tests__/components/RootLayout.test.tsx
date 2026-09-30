import React from "react";
import { render, screen } from "@testing-library/react";

// Mock next/navigation usePathname
jest.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

// Mock wallet hook used by Sidebar
jest.mock("@/hooks/useFreighterWallet", () => ({
  useFreighterWallet: () => ({
    status: "disconnected",
    address: null,
    network: "TEST",
    connect: jest.fn(),
  }),
}));

import RootLayout from "@/app/layout";

describe("RootLayout (Dashboard Layout)", () => {
  it("renders children and the sidebar brand", () => {
    render(
      // @ts-ignore - Next layout typing in tests
      <RootLayout>
        <div>child-content</div>
      </RootLayout>,
    );

    expect(screen.getByText("child-content")).toBeInTheDocument();
    expect(screen.getAllByText(/Soroban Play/i)[0]).toBeInTheDocument();
  });
});
