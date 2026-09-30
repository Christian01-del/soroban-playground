# Decentralized Identity (DID) Registry Specification

Specification for a W3C-compliant Decentralized Identity (DID) Document & Verifiable Credential Registry smart contract on Stellar Soroban.

---

## 1. DID Document Schema Mapping

```rust
#[contracttype]
pub struct DidDocument {
    pub controller: Address,
    pub public_keys: Vec<Symbol>,
    pub service_endpoints: Vec<Symbol>,
    pub deactivated: bool,
}
```

- **`did:soroban:<contract_id>:<address>`**: Deterministic DID identifier mapping.

---

## 2. Verifiable Credential Revocation List

- **Entrypoint:** `revoke_credential(issuer, vc_hash)`
- **Storage:** Persistent storage key `StorageKey::RevokedVc(Bytes32)`.

---

## References

- Implementation: [`contracts/did_registry/src/lib.rs`](../contracts/did_registry/src/lib.rs)
- Issue reference: Fixes #1039
