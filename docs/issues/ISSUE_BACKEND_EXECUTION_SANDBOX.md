---
name: Feature Request
about: Implement contract execution sandboxing and gas estimation service
title: "[BACKEND] Implement Contract Execution Sandboxing and Gas Estimation Service"
labels: enhancement, backend, high-priority
assignees: ""
---

## 📝 Feature Summary

Implement a contract execution sandboxing service that allows safe, isolated execution of Soroban contracts for simulation and gas estimation. This will enable developers to test contract interactions without affecting production state.

## ❓ Problem or Motivation

Developers currently cannot safely test contract interactions or estimate gas costs before deployment. Without execution sandboxing, developers must deploy to testnet to verify functionality, wasting time and resources. Sandbox execution is essential for production-ready development workflows.

## 💡 Proposed Solution

Create a comprehensive execution sandboxing service with:

- Isolated contract execution environment
- Gas estimation and cost calculation
- Simulation capabilities for read/write operations
- Integration with existing compilation and deployment workflows
- Security isolation and resource limits

### Key Features

- `POST /sandbox/execute`: Execute contract in sandbox
- `POST /sandbox/estimate-gas`: Estimate gas for contract operation
- `POST /sandbox/simulate`: Simulate contract interaction
- `GET /sandbox/status`: Get sandbox status and limits
- Integration with compile/deploy/invoke endpoints

### Implementation Details

- Location: `backend/src/routes/sandbox.js`
- Service: `backend/src/services/sandboxService.js`
- Configuration: `backend/src/config/sandbox.config.js`
- Documentation: `backend/src/docs/sandbox.doc.js`

## 🔄 Alternatives Considered

1. **No sandboxing**: Rejected because MVP requires safe testing capabilities
2. **Frontend-only sandboxing**: Rejected because backend isolation is essential for security
3. **External sandbox services**: Rejected due to lack of Soroban-specific optimization

## 🧩 Affected Areas

- [ ] Smart Contracts
- [x] Backend
- [ ] Frontend
- [ ] Testing Infrastructure
- [ ] Documentation

## 📊 Impact & Priority

| Dimension        | Assessment                                                                             |
| ---------------- | -------------------------------------------------------------------------------------- |
| Who benefits?    | All developers testing Soroban contracts                                               |
| Effort estimate  | Large (5-6 days)                                                                       |
| Breaking change? | No                                                                                     |
| MVP impact       | Critical - enables safe testing, gas estimation, and development workflow improvements |

## 🔗 Related Issues or References

- Related to execution: https://github.com/StellarDevHub/soroban-playground/issues/8
- Related to quadratic voting: https://github.com/StellarDevHub/soroban-playground/issues/29
- Existing routes: `backend/src/routes/compile.js`

## ✅ Checklist

- [x] I have searched for existing issues and this is not a duplicate
- [x] I have clearly described the problem this feature solves
- [x] I have considered and noted alternative approaches
- [x] This feature aligns with the project's goal of being a production-ready Soroban IDE
- [x] I am willing to help implement or test this feature
