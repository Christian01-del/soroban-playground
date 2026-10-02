import { StrKey, WebAuth } from "@stellar/stellar-sdk";

export interface Sep10Config {
  serverAccount: string;
  homeDomain: string;
  webAuthDomain: string;
  networkPassphrase: string;
}

export function validateChallenge(
  xdr: string,
  address: string,
  config: Sep10Config,
) {
  if (
    !StrKey.isValidEd25519PublicKey(address) ||
    !StrKey.isValidEd25519PublicKey(config.serverAccount)
  ) {
    throw new Error(
      "Configure a trusted SEP-10 server signing key and connect a Stellar account",
    );
  }
  const { tx, clientAccountID } = WebAuth.readChallengeTx(
    xdr,
    config.serverAccount,
    config.networkPassphrase,
    config.homeDomain,
    config.webAuthDomain,
  );
  const now = Math.floor(Date.now() / 1000);
  if (clientAccountID !== address || tx.memo.type !== "none")
    throw new Error("Challenge account mismatch");
  // Enforce the actual validity window, without the SDK's clock-skew tolerance.
  if (
    !tx.timeBounds ||
    Number(tx.timeBounds.minTime) > now ||
    Number(tx.timeBounds.maxTime) <= now
  ) {
    throw new Error("Challenge expired or not yet valid");
  }
  return tx;
}
