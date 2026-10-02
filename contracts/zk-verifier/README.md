# BN254 Groth16 verifier

This Soroban contract verifies Groth16 proofs with the protocol-native BN254
G1 MSM and multi-pairing host functions (Protocol 26 or newer). The low-level
`verify` method is stateless; the caller supplies a verification key, proof,
and ordered public inputs. The nullifier-protected method stores consumed
nullifiers to prevent proof replay.

## Encoding

- G1 points are 64 bytes: `X || Y`.
- G2 points are 128 bytes: `X.c1 || X.c0 || Y.c1 || Y.c0`.
- Coordinates and public inputs are unsigned big-endian integers.
- The point at infinity uses the all-zero encoding.
- Public inputs must be canonical BN254 Fr values (strictly less than the field
  order); non-canonical aliases are rejected.
- `vk.ic` must contain exactly one more point than the number of public inputs.

These point encodings match Ethereum's alt_bn128 precompiles and the Soroban
BN254 host API. G1 curve membership is checked before use. The host enforces G2
curve and subgroup validity when executing the pairing.

## Usage and security

Call `verify(vk, proof, public_inputs)`. `Ok(true)` means the Groth16 pairing
equation holds, `Ok(false)` means the proof is invalid, and `Err(...)` indicates
invalid input shape or encoding. Host rejection of malformed G2 points aborts
the invocation. For one-time compliance proofs, use
`verify_and_consume_nullifier(vk, proof, public_inputs)`. The
first public input must be the circuit-bound nullifier. It is recorded only
after successful verification; reuse returns `NullifierAlreadyUsed`.

Verification only proves the statement encoded by the circuit and verification
key. Bind the network, contract, asset, amount, recipient, nullifier, and
commitment into the statement as appropriate. Nullifier records use persistent
storage with a 365-day TTL extension; deployments must maintain TTLs for their
required replay-protection period. Use a trusted verification key and audited
circuit; accepting caller-selected keys does not establish application-level
trust.

Run tests from the repository root:

```console
cargo test -p zk-verifier
```
