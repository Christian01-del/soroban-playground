---
name: Feature Request
about: Implement contract template library favorites status indicators
title: "[FRONTEND] Implement Contract Template Library Favorites Status Indicators"
labels: enhancement, frontend, high-priority
assignees: ""
---

## 📝 Feature Summary

Implement status indicators for the contract template library favorites. This will enable developers to quickly see the status of their favorite templates.

## ❓ Problem or Motivation

The current template browsing requires manual navigation through the directory structure each time. Without favorites status indicators, developers cannot quickly see which of their favorite templates are up-to-date, deprecated, or have new versions available. Favorites status indicators are essential for improving developer efficiency and keeping templates current.

## 💡 Proposed Solution

Create comprehensive favorites status indicators implementation with:

- Template status indicators (up-to-date, deprecated, beta, etc.)
- Version comparison and update notifications
- Status filtering and sorting
- Status history and audit trail

### Key Features

- Visual status indicators for each favorite template
- Version comparison showing current vs latest version
- Update notifications for new template versions
- Filter favorites by status (up-to-date, deprecated, beta, etc.)
- Sort favorites by status and version
- Status history and audit trail for changes

### Implementation Details

- Location: `frontend/src/app/template-library/page.tsx`
- Components: `frontend/src/components/FavoritesStatusIndicator.tsx`, `VersionComparison.tsx`
- Integration with existing contract metadata and README files

## 🔄 Alternatives Considered

1. **Manual directory navigation only**: Rejected because MVP requires improved developer experience
2. **Basic favorites only**: Rejected because status indicators require full implementation
3. **Backend-only favorites API**: Rejected because frontend UI is essential for developer experience

## 🧩 Affected Areas

- [ ] Smart Contracts
- [ ] Backend
- [x] Frontend
- [ ] Testing Infrastructure
- [ ] Documentation

## 📊 Impact & Priority

| Dimension        | Assessment                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| Who benefits?    | All developers using the Soroban Playground with frequently updated templates                        |
| Effort estimate  | Small (1-2 days)                                                                                     |
| Breaking change? | No                                                                                                   |
| MVP impact       | High - enables developers to keep their favorite templates current and identify deprecated templates |

## 🔗 Related Issues or References

- Related to template library: https://github.com/StellarDevHub/soroban-playground/issues/1
- Related to quadratic voting: https://github.com/StellarDevHub/soroban-playground/issues/29
- Existing pages: `frontend/src/app/template-library/page.tsx`

## ✅ Checklist

- [x] I have searched for existing issues and this is not a duplicate
- [x] I have clearly described the problem this feature solves
- [x] I have considered and noted alternative approaches
- [x] This feature aligns with the project's goal of being a production-ready Soroban IDE
- [x] I am willing to help implement or test this feature
