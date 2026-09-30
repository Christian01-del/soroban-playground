import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import AbiViewer from "@/components/AbiViewer";
import { WalletProvider } from "@/components/providers/WalletProvider";
import type { ContractAbiFunction } from "@/utils/contractAbi";

const wrap = (ui: React.ReactElement) =>
  render(<WalletProvider>{ui}</WalletProvider>);

const fn: ContractAbiFunction = {
  name: "transfer",
  doc: "Transfer tokens to recipient",
  inputs: [
    { name: "to", type: "address" },
    { name: "amount", type: "u128" },
  ],
};

describe("AbiViewer", () => {
  it("renders parameter count badge", () => {
    wrap(<AbiViewer abiFunction={fn} values={{}} onFieldChange={jest.fn()} />);
    expect(screen.getByText("2 Parameters")).toBeInTheDocument();
  });

  it("renders doc string when present", () => {
    wrap(<AbiViewer abiFunction={fn} values={{}} onFieldChange={jest.fn()} />);
    expect(
      screen.getByText("Transfer tokens to recipient"),
    ).toBeInTheDocument();
  });

  it("does not render doc section when doc is absent", () => {
    const noDoc: ContractAbiFunction = { name: "ping", inputs: [] };
    wrap(
      <AbiViewer abiFunction={noDoc} values={{}} onFieldChange={jest.fn()} />,
    );
    expect(screen.queryByRole("paragraph")).not.toBeInTheDocument();
  });

  it("renders input fields for each parameter", () => {
    wrap(<AbiViewer abiFunction={fn} values={{}} onFieldChange={jest.fn()} />);
    expect(screen.getByText("to")).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
  });

  it("calls onFieldChange when a field value changes", () => {
    const onFieldChange = jest.fn();
    wrap(
      <AbiViewer
        abiFunction={fn}
        values={{ to: "", amount: "" }}
        onFieldChange={onFieldChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/1000000000000000000/i), {
      target: { value: "42" },
    });
    expect(onFieldChange).toHaveBeenCalledWith("amount", "42");
  });

  it("shows zero parameters badge for function with no inputs", () => {
    const noInputs: ContractAbiFunction = { name: "pause", inputs: [] };
    wrap(
      <AbiViewer
        abiFunction={noInputs}
        values={{}}
        onFieldChange={jest.fn()}
      />,
    );
    expect(screen.getByText("0 Parameters")).toBeInTheDocument();
  });
});
