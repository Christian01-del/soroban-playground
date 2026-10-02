# Wallet authentication and sessions

Connect a wallet, then choose **Sign in with wallet** in Wallet Status. The client
validates the server signature, sequence zero, account, home domain, web auth
domain, network and time bounds before opening the wallet signature prompt. The
challenge is never submitted to the Stellar network. Signing in authenticates
the account's master key; delegated signers, multisig, muxed accounts and client
domain attribution are outside this implementation's scope.

Configure the backend with a stable `STELLAR_SERVER_SECRET` and matching
`STELLAR_SERVER_ACCOUNT`. Set `SEP10_HOME_DOMAIN` and `SEP10_WEB_AUTH_DOMAIN` to
the trusted home and authentication hostnames, and `STELLAR_NETWORK_PASSPHRASE`
to the chosen network (defaults to Testnet). Never expose the signing secret in
frontend configuration. Production startup requires both signing settings and
`JWT_SECRET`; the existing password demo login is disabled in production.

Configure these public frontend build variables independently of the challenge
response:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | API origin, without `/api` |
| `NEXT_PUBLIC_SEP10_SERVER_ACCOUNT` | Backend's public signing key (required for login) |
| `NEXT_PUBLIC_SEP10_HOME_DOMAIN` | Same as backend `SEP10_HOME_DOMAIN` (default `localhost`) |
| `NEXT_PUBLIC_SEP10_WEB_AUTH_DOMAIN` | Same as backend `SEP10_WEB_AUTH_DOMAIN` (default `localhost`) |
| `NEXT_PUBLIC_SEP10_NETWORK_PASSPHRASE` | Same as backend network passphrase (default Testnet) |

Use HTTPS and serve frontend/API on the same site in production: refresh and
access cookies are HttpOnly, Secure in production and SameSite=Strict. For local
development, use localhost for both services. Enable credentialed CORS for the
exact frontend origin when the API uses a different origin. The existing API
uses `GET /api/auth/challenge?address=G...` and
`POST /api/auth/verify {address, transactionXDR}`; these are internal routes,
not a public anchor discovery endpoint.

Access JWTs are signed by the backend and held only in memory, so existing
bearer-authenticated clients can use `useAuth().getAuthToken()`. JWT claims on
the frontend are used only for identity display and scheduling; authorization
and signature verification remain on the server. Refresh JWTs are returned only
as cookies. Auth responses use `Cache-Control: no-store`. Refresh restores the
session after reload without another wallet prompt and rotates tokens before
expiry. Concurrent refresh calls share one request. Refresh failure clears the
session and requires sign-in again.

Wallet account/network changes and disconnect clear the shared session and
revoke its refresh-token family. Logout waits for any outstanding rotation,
clears both cookies and blacklists the current access token. Access tokens in the revoked family are also rejected. Legacy access tokens
without a family ID remain valid until expiry unless individually blacklisted.
Challenge exchanges reserve their transaction hash atomically; refresh rotation
reserves each token ID atomically and rejects reuse by revoking its family.
Use shared Redis in production for replay protection across server instances;
the existing Redis service's in-memory fallback is limited to one process.

Run the regression suites:

```sh
npm run test --workspace=frontend -- src/__tests__/auth
node node_modules/jest/bin/jest.js --config backend/jest.config.cjs backend/tests/sep10Session.test.js backend/tests/authService.unit.test.js --runInBand
```

Both suites run in the pull-request CI pipeline. The client suite uses real SDK
challenges and signatures, with mocked HTTP responses; backend integration
tests exercise Express routes, signatures, cookie rotation and replay handling
with an in-memory mock of atomic Redis operations.
