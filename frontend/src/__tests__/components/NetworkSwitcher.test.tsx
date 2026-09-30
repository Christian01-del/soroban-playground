import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import NetworkSwitcher, { NETWORKS } from "../../components/NetworkSwitcher";

let mockTime = 0;

beforeAll(() => {
  jest.spyOn(performance, "now").mockImplementation(() => {
    mockTime += 100;
    return mockTime;
  });
});

beforeEach(() => {
  mockTime = 0;
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("NetworkSwitcher", () => {
  beforeEach(() => {
    // Reset fetch mock before each test
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: { status: "healthy" } }),
      }),
    ) as jest.Mock;

    // Clear local storage
    localStorage.clear();
  });

  it("renders default network and ping endpoints on mount", async () => {
    render(<NetworkSwitcher />);

    // Check if default network (Testnet) is rendered
    expect(screen.getByText("Testnet")).toBeInTheDocument();

    // Check if all networks are pinged (Checking... state first)
    // Wait for the checking state to resolve and the latency to be displayed
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(Object.keys(NETWORKS).length);
    });

    // Check if latency is rendered
    const msTexts = await screen.findAllByText(/\d+ms/);
    expect(msTexts.length).toBeGreaterThan(0);
  });

  it("displays Timeout when fetch aborts", async () => {
    // Mock fetch to simulate AbortError (Timeout)
    const abortError = new Error("The user aborted a request.");
    abortError.name = "AbortError";
    global.fetch = jest.fn(() => Promise.reject(abortError)) as jest.Mock;

    render(<NetworkSwitcher />);

    // Open dropdown
    fireEvent.click(screen.getByRole("button", { name: "Select Network" }));

    await waitFor(() => {
      const offlineTexts = screen.getAllByText("Offline");
      expect(offlineTexts.length).toBeGreaterThan(0);
      const timeoutTexts = screen.getAllByText("Timeout");
      expect(timeoutTexts.length).toBeGreaterThan(0);
    });
  });

  it("displays HTTP status when response is not ok", async () => {
    // Mock fetch to simulate HTTP 503 error
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 503,
      }),
    ) as jest.Mock;

    render(<NetworkSwitcher />);

    // Open dropdown
    fireEvent.click(screen.getByRole("button", { name: "Select Network" }));

    await waitFor(() => {
      const offlineTexts = screen.getAllByText("Offline");
      expect(offlineTexts.length).toBeGreaterThan(0);
      const httpTexts = screen.getAllByText("HTTP 503");
      expect(httpTexts.length).toBeGreaterThan(0);
    });
  });

  it("displays Unhealthy response when status is not healthy", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: null }),
      }),
    ) as jest.Mock;

    render(<NetworkSwitcher />);

    // Open dropdown
    fireEvent.click(screen.getByRole("button", { name: "Select Network" }));

    await waitFor(() => {
      const offlineTexts = screen.getAllByText("Offline");
      expect(offlineTexts.length).toBeGreaterThan(0);
      const errorTexts = screen.getAllByText("Unhealthy response");
      expect(errorTexts.length).toBeGreaterThan(0);
    });
  });

  it("displays generic Network Error on throw", async () => {
    global.fetch = jest.fn(() =>
      Promise.reject(new Error("Failed to fetch")),
    ) as jest.Mock;

    render(<NetworkSwitcher />);

    // Open dropdown
    fireEvent.click(screen.getByRole("button", { name: "Select Network" }));

    await waitFor(() => {
      const offlineTexts = screen.getAllByText("Offline");
      expect(offlineTexts.length).toBeGreaterThan(0);
      const errTexts = screen.getAllByText("Failed to fetch");
      expect(errTexts.length).toBeGreaterThan(0);
    });
  });

  it("can switch networks", async () => {
    render(<NetworkSwitcher />);

    // Open dropdown
    fireEvent.click(screen.getByRole("button", { name: "Select Network" }));

    // Click Mainnet
    fireEvent.click(screen.getByText("Mainnet"));

    // Check if Mainnet is selected
    await waitFor(() => {
      expect(localStorage.getItem("soroban_playground_network")).toBe(
        "mainnet",
      );
    });
  });
});
