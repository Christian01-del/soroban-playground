# Contract Source Verification

The verification service checks whether submitted Rust source produces the exact WASM bytes currently deployed for a Soroban contract.

## API

- `POST /api/verify/contracts` submits source for verification.
- `GET /api/verify/contracts/:id` returns status and hashes, without source code.
- `GET /api/verify/contracts/:id/source` returns the stored source record after a successful match.
- `POST /api/verify/contracts/:id/reverify` repeats verification against the current on-chain WASM.
- `GET /api/verify/contracts/search` filters records by `contractId`, `network`, and `status`.

A submission must include `contractId` and `sourceCode`. `contractId` is validated as a checksummed Stellar contract address. `sourceCode` is the contents of the crate's `src/lib.rs` used by the existing compiler. `dependencies` are passed through the same sanitized Cargo dependency flow as `/api/compile`.

For already-built artifacts, callers can supply either `wasmBase64` or `wasmPath`. Paths must remain inside `VERIFICATION_ARTIFACT_ROOT` (which defaults to the backend working directory). Base64 and file artifacts are bounded by `VERIFICATION_MAX_WASM_BYTES`.

## Hashes and status

- `sourceHash`: SHA-256 of the submitted UTF-8 source text.
- `wasmHash`: SHA-256 of the exact bytes produced by Cargo or supplied by the caller.
- `onChainWasmHash`: SHA-256 of the exact WASM retrieved from Soroban RPC.
- `verified`: true only when `wasmHash` and `onChainWasmHash` are equal.

A mismatch is a completed verification with status `mismatch`; it is not treated as a transport or server error. Compilation and RPC failures are stored as `failed` records with a machine-readable error code.

## Configuration

- `SOROBAN_RPC_URL` sets the default Soroban RPC endpoint.
- `<NETWORK>_RPC_URL` overrides the endpoint for a named network, for example `TESTNET_RPC_URL`.
- `VERIFICATION_ARTIFACT_ROOT` limits accepted local WASM paths.
- `VERIFICATION_MAX_SOURCE_BYTES` defaults to 1 MiB.
- `VERIFICATION_MAX_WASM_BYTES` defaults to 20 MiB.

The storage table is created by migration `V007__contract_verification` and is also initialized lazily for compatibility with deployments that do not run migrations during startup.
