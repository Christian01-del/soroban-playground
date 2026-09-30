# Prometheus Metrics Collection & Jaeger Distributed Tracing Specification

Technical specification for instrumenting backend RPC relay nodes and compilation services with Prometheus metrics export and Jaeger distributed tracing on Stellar Soroban.

---

## 1. Metrics & Tracing Architecture

- **Prometheus Scrape Endpoint:** /metrics serving http_requests_total, wasm_compile_duration_seconds, and
  pc_latency_seconds.
- **Jaeger Context Propagation:** raceparent headers injected across all async worker tasks.

---

## References

- Issue reference: Fixes #1029
