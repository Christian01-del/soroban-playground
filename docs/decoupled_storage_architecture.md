# Decoupled Storage Key Architecture Guide

Architectural specification for decoupling instance, persistent, and temporary storage entries in Soroban smart contracts.

---

## Storage Tier Assignment Matrix

| Entry Type                    | Storage Tier       | Expiration Policy                       | Use Case                   |
| :---------------------------- | :----------------- | :-------------------------------------- | :------------------------- |
| **Contract Config / Admin**   | Instance Storage   | Auto-bumped on admin calls              | Immutable setup parameters |
| **User Balances / Schedules** | Persistent Storage | Bounded TTL (~60 days) with auto-extend | Long-lived assets & state  |
| **Nonces & Signature Hashes** | Temporary Storage  | Short-lived (~7 days)                   | Replay protection          |

---

## Code Pattern Example

```rust
// Storage Tier Decoupling
pub fn read_balance(env: &Env, owner: Address) -> i128 {
    env.storage()
        .persistent()
        .get(&StorageKey::Balance(owner))
        .unwrap_or(0)
}
```

---

## References

- Soroban storage docs: https://developers.stellar.org/docs/learn/smart-contracts/storing-data
- Issue reference: Fixes #1036
