# Cross-Contract Invocation Guard Specification

Security design specification for enforcing invoker authorization and cross-contract call stack reentrancy protection on Stellar Soroban.

---

## 1. Call Stack Reentrancy Guard

```rust
pub fn require_not_entered(env: &Env) {
    let key = Symbol::new(env, "entered");
    if env.storage().temporary().has(&key) {
        panic_with_error!(env, Error::ReentrancyGuardTriggered);
    }
    env.storage().temporary().set(&key, &true);
}
```

---

## 2. Invoker Whitelist Matrix

- Restricts entrypoints to pre-authorized invoker contracts registered by Admin.

---

## References

- Implementation: [`contracts/invocation_guard/src/lib.rs`](../contracts/invocation_guard/src/lib.rs)
- Issue reference: Fixes #1032
