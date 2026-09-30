import React from "react";
import { render, screen } from "@testing-library/react";
import WalletConnectionWizard from "@/components/WalletConnectionWizard";
import { WalletProvider } from "@/components/providers/WalletProvider";

describe("WalletConnectionWizard", () => {
  it("renders all wallet options (Freighter, Albedo, xBull, Rango, Soroban Wallet)", () => {
    render(
      <WalletProvider>
        <WalletConnectionWizard />
      </WalletProvider>,
    );

    expect(
      screen.getByText(/Unified Stellar Wallet Suite/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Freighter/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Albedo Link/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /xBull Wallet/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Rango Suite/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Soroban Wallet/i }),
    ).toBeInTheDocument();
  });
});
