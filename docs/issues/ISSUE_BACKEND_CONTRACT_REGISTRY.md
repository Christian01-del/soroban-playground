---
name: Feature Request
about: Implement centralized contract registry service
title: "[BACKEND] Implement Centralized Contract Registry Service"
labels: enhancement, backend, high-priority
assignees: ""
---

## 📝 Feature Summary

Implement a centralized contract registry service that provides discoverability and metadata management for Soroban contracts. This will enable contract discovery, verification, and ecosystem interoperability.

## ❓ Problem or Motivation

Soroban contracts currently cannot be discovered or registered in a centralized location. Without a contract registry, developers must manually track contract addresses and interfaces, creating maintenance challenges and reducing interoperability. A centralized contract registry is essential for production-ready ecosystems.

## 💡 Proposed Solution

Create a comprehensive contract registry service with:

- REST API for contract registration and discovery
- Database storage for contract metadata
- Verification and validation capabilities
- Search and filtering functionality
- Integration with existing contract templates

### Key Features

- `POST /registry/contracts`: Register new contract
- `GET /registry/contracts`: List all contracts
- `GET /registry/contracts/{id}`: Get contract details
- `GET /registry/contracts/search`: Search by name, category, functionality
- `POST /registry/contracts/{id}/verify`: Verify contract source code

### Implementation Details

- Location: `backend/src/routes/registry.js`
- Service: `backend/src/services/registryService.js`
- Database: PostgreSQL table `contract_registry`
- Documentation: `backend/src/docs/registry.doc.js`

## 🔄 Alternatives Considered

1. **Manual contract address tracking only**: Rejected because MVP requires automated discovery
2. **Frontend-only registry UI**: Rejected because backend service is essential for reliability
3. **External registry services**: Rejected due to lack of Soroban-specific optimization

## 🧩 Affected Areas

- [ ] Smart Contracts
- [x] Backend
- [ ] Frontend
- [ ] Testing Infrastructure
- [ ] Documentation

## 📊 Impact & Priority

| Dimension        | Assessment                                                                 |
| ---------------- | -------------------------------------------------------------------------- |
| Who benefits?    | All developers building interconnected applications                        |
| Effort estimate  | Medium (4-5 days)                                                          |
| Breaking change? | No                                                                         |
| MVP impact       | Critical - enables contract discoverability and ecosystem interoperability |

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
