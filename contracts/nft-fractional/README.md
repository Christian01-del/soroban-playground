# NFT Fractionalization Vault

This Soroban contract locks one NFT, issues a fixed supply of transferable
fractions, and sells the NFT through an escrowed ascending buyout auction. The
fraction interface follows SEP-41 (`transfer`, `transfer_from`, `approve`,
`allowance`, `balance`, `decimals`, `name`, `symbol`, and `total_supply`).

## Lifecycle

1. The NFT owner approves the vault contract as an operator on the NFT contract.
2. Call `initialize(curator, depositor, config)`. The NFT is transferred into
   custody and all fractions are minted to the depositor in the same transaction.
3. Any funded buyer can call `start_auction`. The opening bid must meet the
   reserve price and is transferred into escrow.
4. Buyers call `bid` before the deadline. Each bid must satisfy the configured
   basis-point increment. The displaced bid is refunded atomically.
5. Anyone calls `settle` after the deadline. The NFT goes to the winner and the
   winning bid becomes claimable proceeds.
6. Fraction holders call `claim(holder, amount)`. Fractions are burned and the
   corresponding remaining proceeds are paid out. The final claimant receives
   any integer-division remainder.

The NFT contract must expose `owner_of(u64)` and
`transfer_from(caller, from, to, u64)`, matching the playground's ERC-721
contract. The payment asset must implement the standard Soroban token interface.

## Security properties

- NFT custody is verified during initialization.
- The fractional supply cannot be inflated after initialization.
- All user-controlled token movements require Soroban authorization.
- Bids are escrowed, outbids refund atomically, and settlement cannot occur early.
- State changes and cross-contract calls are transactionally atomic on Soroban.
- Checked arithmetic protects bid calculations and accounting; invalid and zero
  amounts are rejected.
- Instance state has its TTL refreshed during authenticated lifecycle operations.

Run the contract tests with:

```sh
cargo test -p nft-fractional
```
