# Escrow and Multi-Asset Atomic Swaps

This Soroban contract retains its original freelancer milestone escrow API and
adds a token-custody subsystem for bilateral hash time-locked atomic swaps.
Legacy escrow storage, methods, and return values remain unchanged.

## Atomic swap lifecycle

1. The maker chooses a random preimage off-chain and computes its SHA-256 hash.
2. `create_atomic_swap` locks the maker's offered token amount, names the exact
   taker and requested token amount, and records the hashlock and expiry.
3. The designated taker calls `fund_atomic_swap`, locking the requested asset.
4. Before expiry, anyone may call `claim_atomic_swap` with the preimage. The
   contract verifies SHA-256 and transfers both token legs in the same Soroban
   transaction: offered tokens to the taker and requested tokens to the maker.
5. At or after expiry, `refund_atomic_swap` returns every funded leg to its
   original owner. The call is permissionless, allowing keepers to clear stale
   escrows. Before taker funding, the maker may instead cancel early.

Successful claims publish and persist the bounded preimage, allowing another
contract or chain using the same hashlock to observe the secret and settle its
linked HTLC. Maker and taker addresses may be accounts or contracts; asset
custody and settlement use Soroban token cross-contract calls.

## Safety properties

- Maker, taker, token pair, positive amounts, SHA-256 hashlock, and timelock
  ranges are validated before custody begins.
- Timelocks must be between 60 seconds and 30 days from creation.
- Only the designated taker can fund the second leg.
- Claims require both legs, a 1–64 byte preimage, and an unexpired swap.
- State is finalized before outgoing token calls, preventing replay and making
  both transfers transactional: any failed token call rolls back everything.
- Refund, cancellation, and claim states are mutually exclusive.
- Swap records and instance state renew to a 90-day ledger lifetime before
  falling below 30 days, keeping every allowed timelock safely refundable.
- Lifecycle counters provide total, active, claimed, refunded, and cancelled
  swap monitoring without mixing incomparable token denominations.

## Example

```text
secret   = random bytes
hashlock = SHA256(secret)

id = create_atomic_swap(
  maker, taker,
  token_a, 100_0000000,
  token_b, 250_0000000,
  hashlock, expiry
)
fund_atomic_swap(id, taker)
claim_atomic_swap(id, secret)
```

Run the complete focused suite from the repository root:

```sh
cargo test -p escrow
```
