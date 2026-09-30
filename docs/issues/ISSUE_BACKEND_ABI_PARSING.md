---
name: Feature Request
about: Implement contract ABI parsing and metadata service
title: "[BACKEND] Implement Contract ABI Parsing and Metadata Service"
labels: enhancement, backend, high-priority
assignees: ""
---

## 📝 Feature Summary

Implement a contract ABI parsing service that extracts and manages contract interface information from Soroban WASM binaries. This will enable auto-generated UIs, documentation, and tooling integration.

## ❓ Problem or Motivation

Soroban contracts currently require manual ABI definition and management. Without automated ABI parsing, developers must manually define interfaces, leading to inconsistencies and maintenance challenges. ABI parsing is essential for production-ready tooling and developer experience.

## 💡 Proposed Solution

Create a comprehensive ABI parsing service with:

- WASM binary analysis and interface extraction
- JSON ABI format generation and storage
- Metadata management and versioning
- Integration with contract registry
- Documentation generation capabilities

### Key Features

- `POST /abi/parse`: Parse WASM binary and extract ABI
- `GET /abi/{id}`: Get contract ABI
- `GET /abi/{id}/functions`: List contract functions
- `GET /abi/{id}/events`: List contract events
- `GET /abi/{id}/metadata`: Get contract metadata

### Implementation Details

- Location: `backend/src/routes/abi.js`
- Service: `backend/src/services/abiService.js`
- Database: PostgreSQL table `contract_abi`
- Documentation: `backend/src/docs/abi.doc.js`

## 🔄 Alternatives Considered

1. **Manual ABI definition only**: Rejected because MVP requires automated tooling
2. **Frontend-only ABI parsing**: Rejected because backend service is essential for reliability
3. **External ABI services**: Rejected due to lack of Soroban-specific optimization

## 🧩 Affected Areas

- [ ] Smart Contracts
- [x] Backend
- [ ] Frontend
- [ ] Testing Infrastructure
- [ ] Documentation

## 📊 Impact & Priority

| Dimension        | Assessment                                                                |
| ---------------- | ------------------------------------------------------------------------- |
| Who benefits?    | All developers building Soroban applications                              |
| Effort estimate  | Medium (3-4 days)                                                         |
| Breaking change? | No                                                                        |
| MVP impact       | High - enables auto-generated UIs, documentation, and tooling integration |

## 🔗 Related Issues or References

- Related to synthetic assets: https://github.com/StellarDevHub/soroban-playground/issues/337
- Related to quadratic voting: https://github.com/StellarDevHub/soroban-playground/issues/29
- Existing routes: `backend/src/routes/quadraticVoting.js`

## ✅ Checklist

- [x] I have searched for existing issues and this is not a duplicate
- [x] I have clearly described the problem this feature solves
- [x] I have considered and noted alternative approaches
- [x] This feature aligns with the project's goal of being a production-ready Soroban IDE
- [x] I am willing to help implement or test this feature
