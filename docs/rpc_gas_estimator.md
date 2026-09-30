# Soroban RPC Gas & Resource Footprint Estimator Specification

Endpoint specification for dry-running WASM invocations to return exact CPU instruction counts, memory read/write bytes, and storage footprint estimates.

---

## 1. Estimator Endpoint Schema

`json
{
  "cpu_instructions": 1420500,
  "mem_bytes": 65536,
  "read_bytes": 1024,
  "write_bytes": 512,
  "min_fee_stroops": 10000
}
`

---

## References

- Issue reference: Fixes #1027
