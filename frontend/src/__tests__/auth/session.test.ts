/** @jest-environment node */
import { webcrypto } from "node:crypto";
import { Keypair, Networks, Transaction, WebAuth } from "@stellar/stellar-sdk";
import { SessionManager } from "../../lib/auth/session";
import { validateChallenge } from "../../lib/auth/sep10";

Object.defineProperty(global, "crypto", {
  value: webcrypto,
  configurable: true,
});

const server = Keypair.random();
const client = Keypair.random();
const config = {
  serverAccount: server.publicKey(),
  homeDomain: "playground.example",
  webAuthDomain: "auth.example",
  networkPassphrase: Networks.TESTNET,
};
const challenge = () =>
  WebAuth.buildChallengeTx(
    server,
    client.publicKey(),
    config.homeDomain,
    300,
    Networks.TESTNET,
    config.webAuthDomain,
  );
const token = (
  sub = client.publicKey(),
  expires = Math.floor(Date.now() / 1000) + 900,
) =>
  `e30.${Buffer.from(JSON.stringify({ sub, type: "access", exp: expires })).toString("base64url")}.signature`;
const response = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 401,
  json: async () => body,
});
const sign = jest.fn(async (xdr: string) => {
  const tx = new Transaction(xdr, Networks.TESTNET);
  tx.sign(client);
  return tx.toXDR();
});
const mockFetch = global.fetch as jest.Mock;

describe("SEP-10 client and memory sessions", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    sign.mockClear();
  });

  it("validates a real server challenge before signing and exchanges it with credentials", async () => {
    const manager = new SessionManager("https://api.example", config);
    mockFetch
      .mockResolvedValueOnce(
        response({
          transaction: challenge(),
          network_passphrase: Networks.TESTNET,
        }),
      )
      .mockResolvedValueOnce(response({ accessToken: token() }));
    await manager.login(client.publicKey(), sign);
    expect(manager.getSnapshot().user?.id).toBe(client.publicKey());
    expect(sign).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[1][1]).toMatchObject({
      credentials: "include",
      cache: "no-store",
      method: "POST",
    });
    const sent = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(
      WebAuth.verifyChallengeTxSigners(
        sent.transactionXDR,
        server.publicKey(),
        Networks.TESTNET,
        [client.publicKey()],
        config.homeDomain,
        config.webAuthDomain,
      ),
    ).toEqual([client.publicKey()]);
  });

  it.each([
    ["server key", { serverAccount: Keypair.random().publicKey() }],
    ["home domain", { homeDomain: "evil.example" }],
    ["web auth domain", { webAuthDomain: "evil.example" }],
    ["network", { networkPassphrase: Networks.PUBLIC }],
  ])(
    "rejects an untrusted %s before invoking the wallet",
    async (_name, override) => {
      const manager = new SessionManager("", { ...config, ...override });
      mockFetch.mockResolvedValueOnce(response({ transaction: challenge() }));
      await expect(manager.login(client.publicKey(), sign)).rejects.toThrow();
      expect(sign).not.toHaveBeenCalled();
      expect(manager.getSnapshot().token).toBeNull();
    },
  );

  it("rejects expired and wrong-account challenges", () => {
    expect(() =>
      validateChallenge(challenge(), Keypair.random().publicKey(), config),
    ).toThrow();
    const xdr = challenge();
    const clock = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 301000);
    try {
      expect(() =>
        validateChallenge(xdr, client.publicKey(), config),
      ).toThrow();
    } finally {
      clock.mockRestore();
    }
  });

  it("does not exchange a declined signature", async () => {
    const manager = new SessionManager("", config);
    mockFetch.mockResolvedValueOnce(response({ transaction: challenge() }));
    await expect(
      manager.login(client.publicKey(), async () => null),
    ).rejects.toThrow("declined");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("deduplicates refresh and clears a rejected session", async () => {
    const manager = new SessionManager("", config);
    mockFetch.mockResolvedValueOnce(response({ accessToken: token() }));
    await Promise.all([
      manager.refresh(),
      manager.refresh(),
      manager.refresh(),
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(await manager.getAuthToken()).toBe(token());
    mockFetch.mockResolvedValueOnce(response({}, false));
    await expect(manager.refresh()).rejects.toThrow();
    expect(manager.getSnapshot().token).toBeNull();
  });

  it("refreshes before supplying a nearly expired bearer token", async () => {
    const manager = new SessionManager("", config);
    mockFetch
      .mockResolvedValueOnce(
        response({
          accessToken: token(
            client.publicKey(),
            Math.floor(Date.now() / 1000) + 20,
          ),
        }),
      )
      .mockResolvedValueOnce(response({ accessToken: token() }));
    await manager.refresh();
    expect(await manager.getAuthToken()).toBe(token());
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("clears state immediately and serializes logout after an in-flight refresh", async () => {
    const manager = new SessionManager("", config);
    let resolve!: (value: unknown) => void;
    mockFetch
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce(response({ success: true }));
    const refreshing = manager.refresh();
    await Promise.resolve();
    const loggingOut = manager.logout();
    expect(manager.getSnapshot().token).toBeNull();
    resolve(response({ accessToken: token() }));
    await Promise.all([refreshing, loggingOut]);
    expect(manager.getSnapshot().token).toBeNull();
    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/auth/refresh",
      "/api/auth/logout",
    ]);
  });

  it("cancels an outstanding wallet signature on account change/logout", async () => {
    const manager = new SessionManager("", config);
    let finish!: (value: string) => void;
    const signing = jest.fn(
      () =>
        new Promise<string>((done) => {
          finish = done;
        }),
    );
    mockFetch
      .mockResolvedValueOnce(response({ transaction: challenge() }))
      .mockResolvedValueOnce(response({}));
    const login = manager.login(client.publicKey(), signing);
    while (!signing.mock.calls.length) await Promise.resolve();
    await manager.logout();
    finish(challenge());
    await expect(login).rejects.toThrow("cancelled");
    expect(
      mockFetch.mock.calls.some(([url]) => url === "/api/auth/verify"),
    ).toBe(false);
  });

  it("rejects malformed, expired or wrong-subject session responses", async () => {
    for (const invalid of [
      "invalid",
      token(client.publicKey(), 1),
      token(Keypair.random().publicKey()),
    ]) {
      const manager = new SessionManager("", config);
      mockFetch
        .mockResolvedValueOnce(response({ transaction: challenge() }))
        .mockResolvedValueOnce(response({ accessToken: invalid }));
      await expect(manager.login(client.publicKey(), sign)).rejects.toThrow();
      expect(manager.getSnapshot().token).toBeNull();
    }
  });
});
