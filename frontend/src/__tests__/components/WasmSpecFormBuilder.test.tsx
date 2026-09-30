import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import WasmSpecFormBuilder from "@/components/WasmSpecFormBuilder";
import { WalletProvider } from "@/components/providers/WalletProvider";
import {
  validateSorobanType,
  normalizeType,
  buildDefaultInputValue,
} from "@/utils/contractAbi";

describe("WasmSpecFormBuilder", () => {
  const mockInputs = [
    { name: "to", type: "Address" },
    { name: "amount", type: "u128" },
    { name: "symbol", type: "Symbol" },
  ];

  it("renders typed parameter fields for contract method", () => {
    const values: Record<string, unknown> = {};
    const handleChange = jest.fn();

    render(
      <WalletProvider>
        <WasmSpecFormBuilder
          inputs={mockInputs}
          values={values}
          onChange={handleChange}
        />
      </WalletProvider>,
    );

    expect(screen.getByText("to")).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
    expect(screen.getByText("symbol")).toBeInTheDocument();
  });

  it("calls onChange when typing into input field", () => {
    const values: Record<string, unknown> = {};
    const handleChange = jest.fn();

    render(
      <WalletProvider>
        <WasmSpecFormBuilder
          inputs={mockInputs}
          values={values}
          onChange={handleChange}
        />
      </WalletProvider>,
    );

    const amountInput = screen.getByPlaceholderText(/1000000000000000000/i);
    fireEvent.change(amountInput, { target: { value: "500" } });
    expect(handleChange).toHaveBeenCalledWith("amount", "500");
  });

  it("renders empty-state message when no inputs provided", () => {
    render(
      <WalletProvider>
        <WasmSpecFormBuilder inputs={[]} values={{}} onChange={jest.fn()} />
      </WalletProvider>,
    );
    expect(screen.getByText(/no parameters/i)).toBeInTheDocument();
  });

  it("does not show validation error before user interacts", () => {
    render(
      <WalletProvider>
        <WasmSpecFormBuilder
          inputs={[{ name: "to", type: "Address" }]}
          values={{ to: undefined }}
          onChange={jest.fn()}
        />
      </WalletProvider>,
    );
    expect(screen.queryByText(/is required/i)).not.toBeInTheDocument();
  });
});

describe("validateSorobanType", () => {
  it("returns required error for empty string", () => {
    expect(validateSorobanType("x", "string", "")).toMatch(/required/);
  });

  it("returns required error for null", () => {
    expect(validateSorobanType("x", "u32", null)).toMatch(/required/);
  });

  it("rejects invalid Stellar address", () => {
    expect(validateSorobanType("addr", "address", "NOTANADDRESS")).toMatch(
      /Stellar Address/,
    );
  });

  it("accepts valid G-address", () => {
    expect(
      validateSorobanType("addr", "address", `G${"A".repeat(55)}`),
    ).toBeNull();
  });

  it("rejects symbol with special characters", () => {
    expect(validateSorobanType("sym", "symbol", "bad symbol!")).toMatch(
      /Symbol/,
    );
  });

  it("rejects non-integer for u128", () => {
    expect(validateSorobanType("n", "u128", "3.14")).toMatch(/integer/);
  });

  it("rejects NaN for number type", () => {
    expect(validateSorobanType("n", "u32", "abc")).toMatch(/numeric/);
  });

  it("rejects empty string for number type", () => {
    expect(validateSorobanType("n", "u32", "")).toMatch(/required/);
  });

  it("rejects invalid JSON array for vec", () => {
    expect(validateSorobanType("v", "Vec<u32>", "not-json")).toMatch(
      /JSON array/,
    );
  });

  it("rejects non-array JSON for vec", () => {
    expect(validateSorobanType("v", "Vec<u32>", "{}")).toMatch(/JSON array/);
  });

  it("rejects invalid JSON object for map", () => {
    expect(validateSorobanType("m", "Map<String,u32>", "[1,2]")).toMatch(
      /JSON object/,
    );
  });
});

describe("normalizeType", () => {
  it("returns string for null/undefined input", () => {
    expect(normalizeType(null as unknown as string)).toBe("string");
    expect(normalizeType(undefined as unknown as string)).toBe("string");
  });

  it("maps known Rust types correctly", () => {
    expect(normalizeType("u32")).toBe("number");
    expect(normalizeType("bool")).toBe("bool");
    expect(normalizeType("Address")).toBe("address");
    expect(normalizeType("Vec<u32>")).toBe("vec");
    expect(normalizeType("Map<String,u32>")).toBe("map");
  });
});

describe("buildDefaultInputValue", () => {
  it("returns false for bool", () =>
    expect(buildDefaultInputValue("bool")).toBe(false));
  it("returns 0 for number", () =>
    expect(buildDefaultInputValue("u32")).toBe(0));
  it("returns [] for vec", () =>
    expect(buildDefaultInputValue("Vec<u32>")).toEqual([]));
  it("returns {} for map", () =>
    expect(buildDefaultInputValue("Map<String,u32>")).toEqual({}));
  it("returns empty string for string", () =>
    expect(buildDefaultInputValue("string")).toBe(""));
});
