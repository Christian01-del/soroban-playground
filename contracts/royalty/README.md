# Royalty Waterfall Engine

This Soroban contract escrows token revenue and allocates it through an immutable,
tiered co-creator tree. It complements the existing `music-royalty` example
without changing its interface.

## Tree model

Agreements use a flat, parent-indexed list so the contract boundary remains
Soroban/XDR compatible. Node zero is the root. Every later node references an
earlier parent and receives `share_bps / 10,000` of that parent's incoming
amount. Whatever is not distributed to children remains payable to the parent.

For example, if the root gives 60% to a producer and that producer gives 25% of
their tier to an engineer, a 10,000-unit deposit produces:

- root: 4,000
- producer: 4,500
- engineer: 1,500

Each local rounding remainder stays with its parent, so every deposited unit is
accounted for exactly once.

## Safety and scaling

- Trees are immutable, topologically ordered, cycle-free, and limited to 64
  unique accounts and eight levels.
- Child shares cannot exceed 100% of a parent tier.
- Deposits are token-backed and use checked arithmetic.
- Distribution updates pending balances rather than issuing many token calls.
- Individual claims and authenticated batches of up to 20 recipients use
  checks-effects-interactions and are retry-safe.
- Pausing blocks configuration and deposits but never traps accrued royalties.
- Agreement and balance TTLs are renewed during normal activity.

Run the targeted tests with `cargo test -p royalty`.
