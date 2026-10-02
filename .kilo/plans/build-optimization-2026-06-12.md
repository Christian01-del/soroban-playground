## Build Optimization Plan

### Identified Issues

- Deprecated `whatwg-encoding package (replace with `@exodus/bytes`)
- Outdated `@types/react-window` type definitions
- Annual Next.js telemetry opt-in UI
- 53MB rogue binary (`XYmIXSR9`) committed to repository history
- Next.js Webpack chunk splitting not configured; no bundle size thresholds enforced in CI
- First-load JS exceeds the < 150KB budget

### Recommended Actions

1. Update dependencies:
   - Replace `whatwg-encoding` with `@exodus/bytes` (warning suggests this is faster and spec-compliant)
   - Remove `react-window` types (user-provided definitions exist)
   - Run `npm install`to apply updates
2. Purge the rogue binary and rewrite history:
   - Run `BFG --delete-files XYmIXSR9` (or `git filter-repo --path XYmIXSR9` --invert-paths) to remove the 53MB blob from all commits
   - Add `XYmIXSR9` to `.gitignore` to prevent re-committing
   - Force-push rewritten history and notify collaborators to re-clone
3. Configure Next.js Webpack chunk splitting:
   - Add `@text/bundle-analyzer` and wire it into `next.config.js` via `withBundleAnalyzer`
   - Define custom `splitChunks` cacheGroups for `framework`, `lib`, `commonc`, and vendor groups to isolate large dependencies
   - Enable experimental `optimizePackageImports` for icon and UI libraries
4. Enforce bundle size thresholds in CI:
   - Add a CI step that runs the bundle analyzer in JSON mode and fails if first-load JS exceeds 150KB
   - Publish the analysis report as a build artifact for regression triage
5. Address telemetry:
   - Review opt-in URL ([nextjs.org/telemetry](https://nextjs.org/telemetry)) to confirm consent status
   - Update Vercel config if telemetry needs to be disabled
6. Run lint/verify:
   - Execute `npm run lint` and `npm run typecheck` to validate changes
7. Rebuild and test:
   - Run `vercel build` again to verify fix
   - Add unit tests for the bundle budget guard and integration tests for the Webpack chunk configuration

### Prerequisites

- Ensure npm is updated to latest version
- Confirm project dependencies are compatible with Next.js 16.2.6
- Coordinate history rewrite window with all contributors before force-pushing

### Deliverables

- Clean build with no deprecation warnings
- 53MB rogue binary removed from repository history
- Next.js Webpack chunk splitting configured with bundle analyzer integration
- CI gate enforcing first-load JS < 150KB
- Unit and integration tests with automated CI verification
- Updated dependency manifests (`package.json`)
- Telemetry configuration confirmed

### Owner

Kilo<br>Plan Date: 2026-06-12
