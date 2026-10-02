import { act, render, screen, waitFor } from "@testing-library/react";
import { AuthProvider } from "../../components/providers/AuthProvider";
import { useAuth } from "../../hooks/useAuth";

jest.mock("@stellar/stellar-sdk", () => ({ Networks: { TESTNET: "testnet" } }));
let mockWallet = {
  address: "GACCOUNT",
  network: "TESTNET",
  status: "connected",
  signTransaction: jest.fn(),
};
jest.mock("../../components/providers/WalletProvider", () => ({
  useWallet: () => mockWallet,
}));
const mockFetch = global.fetch as jest.Mock;
const token = (sub = "GACCOUNT") =>
  `e30.${btoa(JSON.stringify({ sub, type: "access", exp: Math.floor(Date.now() / 1000) + 900 }))}.signature`;

function Consumer({ name }: { name: string }) {
  const auth = useAuth();
  return (
    <div data-testid={name}>
      {auth.isAuthenticated ? auth.user?.id : "signed out"}
    </div>
  );
}
function App() {
  return (
    <AuthProvider>
      <Consumer name="first" />
      <Consumer name="second" />
    </AuthProvider>
  );
}

describe("shared wallet session provider", () => {
  beforeEach(() => {
    mockWallet = {
      address: "GACCOUNT",
      network: "TESTNET",
      status: "connected",
      signTransaction: jest.fn(),
    };
    mockFetch.mockReset();
    if (!AbortSignal.timeout)
      AbortSignal.timeout = () => new AbortController().signal;
  });

  it("restores one cookie session and shares it across consumers", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: token() }),
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId("first")).toHaveTextContent("GACCOUNT"),
    );
    expect(screen.getByTestId("second")).toHaveTextContent("GACCOUNT");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each(["account", "network", "disconnect"])(
    "clears shared sessions on wallet %s changes",
    async (change) => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: token() }),
      });
      const view = render(<App />);
      await waitFor(() =>
        expect(screen.getByTestId("first")).toHaveTextContent("GACCOUNT"),
      );
      if (change === "account") mockWallet.address = "GOTHER";
      if (change === "network") mockWallet.network = "PUBLIC";
      if (change === "disconnect") mockWallet.address = "";
      view.rerender(<App />);
      await waitFor(() =>
        expect(screen.getByTestId("first")).toHaveTextContent("signed out"),
      );
      expect(screen.getByTestId("second")).toHaveTextContent("signed out");
      await waitFor(() =>
        expect(
          mockFetch.mock.calls.some(([url]) => url.endsWith("/logout")),
        ).toBe(true),
      );
    },
  );

  it("rejects a restored session that belongs to another wallet", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: token("GOTHER") }),
    });
    render(<App />);
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(([url]) => url.endsWith("/logout")),
      ).toBe(true),
    );
    expect(screen.getByTestId("first")).toHaveTextContent("signed out");
  });

  it("silently refreshes before expiry and clears state when the session expires", async () => {
    jest.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: token() }),
      })
      .mockResolvedValueOnce({ ok: false, status: 401 });
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("first")).toHaveTextContent("GACCOUNT");
    await act(async () => {
      jest.advanceTimersByTime(841000);
    });
    expect(screen.getByTestId("first")).toHaveTextContent("signed out");
    jest.useRealTimers();
  });
});
