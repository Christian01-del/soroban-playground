---
name: Feature Request
about: Implement contract deployment network selection and configuration
title: "[FRONTEND] Implement Contract Deployment Network Selection and Configuration"
labels: enhancement, frontend, high-priority
assignees: ""
---

## 📝 Feature Summary

Implement comprehensive network selection and configuration for the contract deployment wizard. This will enable developers to deploy to different networks with appropriate configuration.

## ❓ Problem or Motivation

The current deployment process requires developers to manually configure network settings. Without network selection, developers must remember and enter complex RPC endpoints, making deployment error-prone and time-consuming. Network selection is essential for improving developer experience and reducing deployment errors.

## 💡 Proposed Solution

Create comprehensive network selection implementation with:

- Pre-configured network options (Stellar Testnet, Futurenet, custom)
- Network-specific configuration and validation
- Real-time network status checking
- Custom network configuration
- Network documentation and guidance

### Key Features

- Pre-configured network options with automatic configuration
- Network status indicators (online, offline, slow)
- Custom network configuration with validation
- Network documentation and usage guidance
- Automatic configuration of network-specific parameters
- Network health checks before deployment

### Implementation Details

- Location: `frontend/src/app/deploy-wizard/page.tsx`
- Components: `frontend/src/components/NetworkSelector.tsx`, `NetworkStatusIndicator.tsx`
- Integration with backend deployment API routes

## 🔄 Alternatives Considered

1. **Manual network configuration only**: Rejected because MVP requires improved developer experience
2. **Basic network dropdown only**: Rejected because comprehensive selection requires status and validation
3. **Backend-only network API**: Rejected because frontend UI is essential for developer experience

## 🧩 Affected Areas

- [ ] Smart Contracts
- [x] Backend
- [x] Frontend
- [ ] Testing Infrastructure
- [ ] Documentation

## 📊 Impact & Priority

| Dimension        | Assessment                                                             |
| ---------------- | ---------------------------------------------------------------------- |
| Who benefits?    | All developers deploying contracts                                     |
| Effort estimate  | Medium (2-3 days)                                                      |
| Breaking change? | No                                                                     |
| MVP impact       | High - significantly improves deployment experience and reduces errors |

## 🔗 Related Issues or References

- Related to deployment: https://github.com/StellarDevHub/soroban-playground/issues/3
- Related to quadratic voting: https://github.com/StellarDevHub/soroban-playground/issues/29
- Existing pages: `frontend/src/app/deploy-wizard/page.tsx`

## ✅ Checklist

- [x] I have searched for existing issues and this is not a duplicate
- [x] I have clearly described the problem this feature solves
- [x] I have considered and noted alternative approaches
- [x] This feature aligns with the project's goal of being a production-ready Soroban IDE
- [x] I am willing to help implement or test this feature
