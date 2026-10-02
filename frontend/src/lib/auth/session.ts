import type { Sep10Config } from "./sep10";

export interface Session {
  token: string | null;
  user: { id: string; username: string } | null;
  expiresAt: number;
}
const EMPTY: Session = { token: null, user: null, expiresAt: 0 };

export class SessionManager {
  private session: Session = EMPTY;
  private listeners = new Set<() => void>();
  private generation = 0;
  private pending: Promise<unknown> = Promise.resolve();
  private refreshRequest: Promise<void> | null = null;
  constructor(
    private baseUrl: string,
    private config: Sep10Config,
  ) {}
  getSnapshot = () => this.session;
  getServerSnapshot = () => EMPTY;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(session: Session) {
    this.session = session;
    this.listeners.forEach((listener) => listener());
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(action, action);
    this.pending = result.catch(() => {});
    return result;
  }
  private async request(path: string, body?: unknown) {
    const response = await fetch(`${this.baseUrl}/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(`Authentication request failed (${response.status})`);
    return response.json();
  }
  private accept(token: unknown, address?: string) {
    if (typeof token !== "string" || token.split(".").length !== 3)
      throw new Error("Invalid session token");
    // Claims schedule refresh and display identity. The API verifies the JWT signature.
    const claims = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (
      claims.type !== "access" ||
      typeof claims.sub !== "string" ||
      typeof claims.exp !== "number" ||
      claims.exp * 1000 <= Date.now() ||
      (address && claims.sub !== address)
    ) {
      throw new Error("Session does not match the authenticated account");
    }
    this.publish({
      token,
      user: { id: claims.sub, username: claims.sub },
      expiresAt: claims.exp * 1000,
    });
  }
  async login(
    address: string,
    sign: (
      xdr: string,
      options: { networkPassphrase: string },
    ) => Promise<string | null>,
  ) {
    const generation = ++this.generation;
    this.publish(EMPTY);
    const challenge = await this.request(
      `/challenge?address=${encodeURIComponent(address)}`,
    );
    if (generation !== this.generation)
      throw new Error("Authentication cancelled");
    if (
      challenge.network_passphrase &&
      challenge.network_passphrase !== this.config.networkPassphrase
    ) {
      throw new Error("Authentication network mismatch");
    }
    const xdr = challenge.transaction ?? challenge.transactionXDR;
    const { validateChallenge } = await import("./sep10");
    if (generation !== this.generation)
      throw new Error("Authentication cancelled");
    const original = validateChallenge(xdr, address, this.config);
    const signed = await sign(xdr, {
      networkPassphrase: this.config.networkPassphrase,
    });
    if (generation !== this.generation)
      throw new Error("Authentication cancelled");
    if (!signed) throw new Error("Wallet signature declined");
    const signedTx = validateChallenge(signed, address, this.config);
    if (
      !signedTx.hash().every((byte, index) => byte === original.hash()[index])
    )
      throw new Error("Wallet changed the authentication challenge");
    await this.enqueue(async () => {
      if (generation !== this.generation)
        throw new Error("Authentication cancelled");
      const response = await this.request("/verify", {
        address,
        transactionXDR: signed,
      });
      if (generation === this.generation)
        this.accept(response.accessToken, address);
    });
  }
  refresh = (): Promise<void> => {
    if (this.refreshRequest) return this.refreshRequest;
    const generation = this.generation;
    const address = this.session.user?.id;
    this.refreshRequest = this.enqueue(async () => {
      if (generation !== this.generation) return;
      try {
        const response = await this.request("/refresh", {});
        if (generation === this.generation)
          this.accept(response.accessToken, address);
      } catch (error) {
        if (generation === this.generation) this.publish(EMPTY);
        throw error;
      }
    }).finally(() => {
      this.refreshRequest = null;
    });
    return this.refreshRequest;
  };
  logout = (): Promise<void> => {
    ++this.generation;
    this.publish(EMPTY);
    // Logout follows any rotation so its replacement cookie is also revoked.
    return this.enqueue(async () => {
      await this.request("/logout", {});
    });
  };
  getAuthToken = async () => {
    if (this.session.token && this.session.expiresAt <= Date.now() + 60000)
      await this.refresh();
    return this.session.token;
  };
}
