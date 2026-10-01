import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import WalletModal from "@/components/WalletModal";
import type { WalletType } from "@/components/providers/WalletProvider";

/**
 * State-driven coverage for WalletModal (#1537).
 *
 * `useWallet` is mocked so each case can pin one connection state without a
 * real browser extension. The adapter list is taken from the real registry so
 * the assertions still reflect the shipped wallets.
 *
 * Variables referenced inside `jest.mock` must be `mock`-prefixed for
 * babel-plugin-jest-hoist.
 */

interface MockWalletState {
  activeWallet: WalletType | null;
  activeAccount: string | null;
  status: string;
  error: string | null;
  lastAttemptedWallet: WalletType | null;
  detected: string[];
  contextIsOpen: boolean;
}

const mockState: MockWalletState = {
  activeWallet: null,
  activeAccount: null,
  status: "disconnected",
  error: null,
  lastAttemptedWallet: null,
  detected: [],
  contextIsOpen: true,
};

const mockConnect = jest.fn();
const mockDisconnect = jest.fn();
const mockRetry = jest.fn();
const mockCloseWalletModal = jest.fn();

jest.mock("@/components/providers/WalletProvider", () => {
  const actual = jest.requireActual("@/components/providers/WalletProvider");
  const { walletRegistry } = jest.requireActual("@/lib/wallets");

  return {
    ...actual,
    useWallet: () => ({
      connect: mockConnect,
      disconnect: mockDisconnect,
      retry: mockRetry,
      activeWallet: mockState.activeWallet,
      activeAccount: mockState.activeAccount,
      status: mockState.status,
      error: mockState.error,
      lastAttemptedWallet: mockState.lastAttemptedWallet,
      isWalletDetected: (id: string) => mockState.detected.includes(id),
      adapters: walletRegistry.getAll(),
      isModalOpen: mockState.contextIsOpen,
      openWalletModal: jest.fn(),
      closeWalletModal: mockCloseWalletModal,
    }),
  };
});

const ACCOUNT = "GB3KJPLFUYN5VL6R3GU3EGCGVCJAFDSDVBBER5SNLZHTMFK3STCQHI4X";

/** Every adapter id registered in `walletRegistry`, in registration order. */
const ALL_ADAPTER_IDS = [
  "freighter",
  "xbull",
  "albedo",
  "hana",
  "walletconnect",
  "rango",
  "soroban-wallet",
];

function resetState(overrides: Partial<MockWalletState> = {}): void {
  Object.assign(mockState, {
    activeWallet: null,
    activeAccount: null,
    status: "disconnected",
    error: null,
    lastAttemptedWallet: null,
    detected: [],
    contextIsOpen: true,
    ...overrides,
  });
}

/** Render with props omitted so the provider context drives `isOpen`. */
function renderViaContext() {
  return render(<WalletModal />);
}

function renderWithProps(onClose = jest.fn()) {
  return render(<WalletModal isOpen onClose={onClose} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConnect.mockResolvedValue(undefined);
  resetState();
});

describe("WalletModal - open state resolution", () => {
  it("renders nothing when both props and context are closed", () => {
    resetState({ contextIsOpen: false });
    renderViaContext();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders when the context is open and no prop is given", () => {
    resetState({ contextIsOpen: true });
    renderViaContext();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("lets the isOpen prop override an open context", () => {
    resetState({ contextIsOpen: true });
    render(<WalletModal isOpen={false} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lets the isOpen prop override a closed context", () => {
    resetState({ contextIsOpen: false });
    render(<WalletModal isOpen />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("marks the dialog as a labelled modal", () => {
    renderWithProps();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "wallet-modal-title");
    expect(document.getElementById("wallet-modal-title")).toHaveTextContent(
      "Connect Stellar Wallet",
    );
  });

  it("renders the header copy and footer", () => {
    renderWithProps();

    expect(
      screen.getByText(/choose your preferred wallet/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Stellar & Soroban Ecosystem")).toBeInTheDocument();
    expect(screen.getByText("SEP-0043 Ready")).toBeInTheDocument();
  });
});

describe("WalletModal - adapter list", () => {
  it("lists every registered wallet by name", () => {
    renderWithProps();

    [
      "Freighter",
      "xBull Wallet",
      "Albedo Link",
      "Hana Wallet",
      "WalletConnect (SEP-0043)",
      "Rango Suite",
      "Soroban Wallet",
    ].forEach((name) => {
      expect(screen.getByText(name)).toBeInTheDocument();
    });
  });

  it("renders a connect control for a detected wallet", () => {
    resetState({ detected: ["freighter"] });
    renderWithProps();

    const connectButtons = screen.getAllByRole("button", { name: "Connect" });
    expect(connectButtons).toHaveLength(1);
  });

  it("renders an install link for every undetected wallet", () => {
    resetState({ detected: ["freighter"] });
    renderWithProps();

    const getLinks = screen.getAllByRole("link", { name: "Get" });
    expect(getLinks).toHaveLength(ALL_ADAPTER_IDS.length - 1);
  });

  it("renders connect controls and no install links when all wallets are detected", () => {
    resetState({ detected: [...ALL_ADAPTER_IDS] });
    renderWithProps();

    expect(screen.getAllByRole("button", { name: "Connect" })).toHaveLength(
      ALL_ADAPTER_IDS.length,
    );
    expect(screen.queryByRole("link", { name: "Get" })).not.toBeInTheDocument();
  });

  it("points each install link at the adapter's installUrl", () => {
    resetState({ detected: ["freighter"] });
    renderWithProps();

    const hrefs = screen
      .getAllByRole("link", { name: "Get" })
      .map((link) => link.getAttribute("href"));

    hrefs.forEach((href) => {
      expect(href).toMatch(/^https?:\/\//);
    });
    expect(new Set(hrefs).size).toBeGreaterThan(1);
  });

  it("opens install links in a new tab without leaking the referrer", () => {
    resetState({ detected: ["freighter"] });
    renderWithProps();

    screen.getAllByRole("link", { name: "Get" }).forEach((link) => {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    });
  });
});

describe("WalletModal - connecting", () => {
  it("labels the in-flight wallet as Connecting", () => {
    resetState({
      detected: [...ALL_ADAPTER_IDS],
      activeWallet: "freighter",
      status: "connecting",
    });
    renderWithProps();

    expect(screen.getByRole("button", { name: /connecting/i })).toBeInTheDocument();
  });

  it("disables every connect control while a connection is in flight", () => {
    resetState({
      detected: [...ALL_ADAPTER_IDS],
      activeWallet: "freighter",
      status: "connecting",
    });
    renderWithProps();

    const connectButtons = screen
      .getAllByRole("button")
      .filter((button) => /^(Connect|Connecting)$/.test(button.textContent ?? ""));

    expect(connectButtons.length).toBe(ALL_ADAPTER_IDS.length);
    connectButtons.forEach((button) => expect(button).toBeDisabled());
  });

  it("does not mark a different wallet as connecting", () => {
    resetState({
      detected: [...ALL_ADAPTER_IDS],
      activeWallet: "freighter",
      status: "connecting",
    });
    renderWithProps();

    // Only Freighter shows the spinner label; the rest stay "Connect".
    expect(screen.getAllByRole("button", { name: "Connecting" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Connect" })).toHaveLength(
      ALL_ADAPTER_IDS.length - 1,
    );
  });

  it("connects the clicked wallet and closes the modal", async () => {
    resetState({ detected: [...ALL_ADAPTER_IDS] });
    const onClose = jest.fn();
    renderWithProps(onClose);

    fireEvent.click(screen.getAllByRole("button", { name: "Connect" })[0]);

    expect(mockConnect).toHaveBeenCalledWith("freighter");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("keeps the modal open when the connection failed", async () => {
    resetState({
      detected: [...ALL_ADAPTER_IDS],
      status: "error",
      error: "Rejected",
    });
    const onClose = jest.fn();
    renderWithProps(onClose);

    fireEvent.click(screen.getAllByRole("button", { name: "Connect" })[0]);

    expect(mockConnect).toHaveBeenCalledWith("freighter");
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("enables connect again once the in-flight state clears", () => {
    resetState({ detected: [...ALL_ADAPTER_IDS], status: "disconnected" });
    renderWithProps();

    screen
      .getAllByRole("button", { name: "Connect" })
      .forEach((button) => expect(button).toBeEnabled());
  });
});

describe("WalletModal - connected state", () => {
  it("shows the active account and names the wallet", () => {
    resetState({
      detected: [...ALL_ADAPTER_IDS],
      activeWallet: "freighter",
      activeAccount: ACCOUNT,
      status: "connected",
    });
    renderWithProps();

    expect(screen.getByText(/connected with freighter/i)).toBeInTheDocument();
    expect(screen.getByText(ACCOUNT)).toBeInTheDocument();
  });

  it("marks only the active adapter as Connected", () => {
    resetState({
      detected: [...ALL_ADAPTER_IDS],
      activeWallet: "freighter",
      activeAccount: ACCOUNT,
      status: "connected",
    });
    renderWithProps();

    expect(screen.getAllByRole("button", { name: /connected/i })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Connect" })).toHaveLength(
      ALL_ADAPTER_IDS.length - 1,
    );
  });

  it("hides the account banner when the connected status has no account", () => {
    resetState({
      detected: [...ALL_ADAPTER_IDS],
      activeWallet: "freighter",
      activeAccount: null,
      status: "connected",
    });
    renderWithProps();

    // The banner is gated on activeAccount, but the adapter row is gated only
    // on activeWallet + status, so the row still reads "Connected". This locks
    // in the current (asymmetric) behaviour rather than asserting an ideal.
    expect(screen.queryByText(/connected with/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connected/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Connect" })).toHaveLength(
      ALL_ADAPTER_IDS.length - 1,
    );
  });

  it("disconnects the wallet", () => {
    resetState({
      detected: [...ALL_ADAPTER_IDS],
      activeWallet: "freighter",
      activeAccount: ACCOUNT,
      status: "connected",
    });
    renderWithProps();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(mockDisconnect).toHaveBeenCalled();
  });
});

describe("WalletModal - error handling", () => {
  it("announces the error in an alert region", () => {
    resetState({ status: "error", error: "User rejected the request." });
    renderWithProps();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "User rejected the request.",
    );
  });

  it("offers a retry naming the wallet that failed", () => {
    resetState({
      status: "error",
      error: "Failed",
      lastAttemptedWallet: "freighter",
    });
    renderWithProps();

    fireEvent.click(screen.getByRole("button", { name: /retry freighter/i }));

    expect(mockRetry).toHaveBeenCalled();
  });

  it("hides retry when no wallet was attempted", () => {
    resetState({ status: "error", error: "Failed", lastAttemptedWallet: null });
    renderWithProps();

    expect(
      screen.queryByRole("button", { name: /retry/i }),
    ).not.toBeInTheDocument();
  });

  it("hides retry when the status is not error", () => {
    resetState({
      status: "disconnected",
      error: "Stale error",
      lastAttemptedWallet: "freighter",
    });
    renderWithProps();

    // The alert still shows, but the retry affordance requires status === "error".
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /retry/i }),
    ).not.toBeInTheDocument();
  });

  it("renders no alert when there is no error", () => {
    renderWithProps();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("WalletModal - dismissal", () => {
  it("closes from the close button", () => {
    const onClose = jest.fn();
    renderWithProps(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("falls back to closeWalletModal when no onClose prop is given", () => {
    renderViaContext();

    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));

    expect(mockCloseWalletModal).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onClose = jest.fn();
    renderWithProps(onClose);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("ignores Escape when the modal is closed", () => {
    resetState({ contextIsOpen: false });
    renderViaContext();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(mockCloseWalletModal).not.toHaveBeenCalled();
  });

  it("ignores other keys", () => {
    const onClose = jest.fn();
    renderWithProps(onClose);

    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: " " });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("removes the keydown listener on unmount", () => {
    const removeSpy = jest.spyOn(window, "removeEventListener");
    const { unmount } = renderWithProps();

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    removeSpy.mockRestore();
  });

  it("does not register a keydown listener while closed", () => {
    resetState({ contextIsOpen: false });
    const addSpy = jest.spyOn(window, "addEventListener");
    renderViaContext();

    expect(addSpy).not.toHaveBeenCalledWith("keydown", expect.any(Function));
    addSpy.mockRestore();
  });
});
